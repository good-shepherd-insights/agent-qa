import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { Tokenizer } from '@huggingface/tokenizers'

const MODEL_ID = 'minishlab/potion-retrieval-32M'
const MODEL_REVISION = '6fc8051fab2a1e0ee76689cf08c853792ac285e7'
const MODEL_DIMENSION = 512
const FLOOR_FORMAT_VERSION = 1
const FLOOR_MAGIC = 'PTNF'
const BINARY_FILE = 'potion-retrieval-32m.i8bin'
const TOKENIZER_FILE = 'tokenizer.json'
const GOLDEN_FILE = 'golden-vectors.json'
const MANIFEST_FILE = 'manifest.json'

const GOLDEN_TEXTS = [
  'Hello, world!',
  'Find the login button on the checkout page.',
  'Café déjà vu — 東京',
  'const answer = items.filter((item) => item.ready)',
  'https://example.test/search?q=agent%20memory&lang=en',
  'Accessibility label: “Continue” 🔎',
  'A user changed their billing address, then retried the failed payment.',
  'Tabs, spaces, punctuation... and UPPERCASE identifiers: BUILD_42.',
] as const

type JsonRecord = Record<string, unknown>

interface TensorDescriptor {
  dtype: string
  shape: [number, number]
  dataOffsets: [number, number]
}

interface SafetensorsMatrix {
  tensorName: string
  dtype: string
  rows: number
  columns: number
  valueAt(row: number, column: number): number
}

interface FileManifestEntry {
  bytes: number
  sha256: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArgs(args: readonly string[]): { outDir: string } {
  let outDir: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--out') {
      outDir = args[index + 1]
      index += 1
      continue
    }
    if (arg?.startsWith('--out=')) {
      outDir = arg.slice('--out='.length)
      continue
    }
    throw new TypeError(`unknown argument: ${String(arg)}`)
  }
  if (outDir === undefined || outDir.trim() === '') {
    throw new TypeError('usage: convert-floor --out <directory>')
  }
  return { outDir: resolve(outDir) }
}

function modelFileUrl(file: string): string {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}?download=true`
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`download failed (${response.status} ${response.statusText}): ${url}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error(`download returned an empty file: ${url}`)
  await writeFile(destination, bytes, { flag: 'wx' })
}

function parseSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return Number(value)
}

function parseDescriptor(value: unknown, name: string): TensorDescriptor {
  if (!isRecord(value)) throw new TypeError(`safetensors tensor ${name} must be an object`)
  if (typeof value.dtype !== 'string') {
    throw new TypeError(`safetensors tensor ${name} has no dtype`)
  }
  if (!Array.isArray(value.shape) || value.shape.length !== 2) {
    throw new TypeError(`safetensors tensor ${name} must be a matrix`)
  }
  if (!Array.isArray(value.data_offsets) || value.data_offsets.length !== 2) {
    throw new TypeError(`safetensors tensor ${name} has invalid data_offsets`)
  }
  return {
    dtype: value.dtype,
    shape: [
      parseSafeInteger(value.shape[0], `${name}.shape[0]`),
      parseSafeInteger(value.shape[1], `${name}.shape[1]`),
    ],
    dataOffsets: [
      parseSafeInteger(value.data_offsets[0], `${name}.data_offsets[0]`),
      parseSafeInteger(value.data_offsets[1], `${name}.data_offsets[1]`),
    ],
  }
}

function dtypeBytes(dtype: string): number {
  switch (dtype) {
    case 'F32':
      return 4
    case 'F16':
    case 'BF16':
      return 2
    default:
      throw new TypeError(`unsupported safetensors embedding dtype: ${dtype}`)
  }
}

function float16ToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 2 ** 10)
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 2 ** 10)
}

function bfloat16ToNumber(bits: number): number {
  const scratch = new ArrayBuffer(4)
  const view = new DataView(scratch)
  view.setUint32(0, bits << 16, true)
  return view.getFloat32(0, true)
}

function makeValueReader(
  bytes: Buffer,
  absoluteStart: number,
  dtype: string,
): (index: number) => number {
  switch (dtype) {
    case 'F32':
      return (index) => bytes.readFloatLE(absoluteStart + index * 4)
    case 'F16':
      return (index) => float16ToNumber(bytes.readUInt16LE(absoluteStart + index * 2))
    case 'BF16':
      return (index) => bfloat16ToNumber(bytes.readUInt16LE(absoluteStart + index * 2))
    default:
      throw new TypeError(`unsupported safetensors embedding dtype: ${dtype}`)
  }
}

function parseEmbeddingMatrix(bytes: Buffer, requiredVocabSize: number): SafetensorsMatrix {
  if (bytes.byteLength < 8) throw new TypeError('safetensors file is shorter than its header')
  const headerLengthBig = bytes.readBigUInt64LE(0)
  if (headerLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('safetensors header length exceeds the safe integer range')
  }
  const headerLength = Number(headerLengthBig)
  const dataStart = 8 + headerLength
  if (headerLength === 0 || dataStart > bytes.byteLength) {
    throw new TypeError('safetensors header length exceeds the file length')
  }

  const parsedHeader: unknown = JSON.parse(bytes.subarray(8, dataStart).toString('utf8'))
  if (!isRecord(parsedHeader)) throw new TypeError('safetensors header must be an object')

  const candidates = Object.entries(parsedHeader)
    .filter(([name]) => name !== '__metadata__')
    .flatMap(([name, value]) => {
      try {
        const descriptor = parseDescriptor(value, name)
        const [rows, columns] = descriptor.shape
        return columns === MODEL_DIMENSION && rows >= requiredVocabSize
          ? [{ name, descriptor }]
          : []
      } catch {
        return []
      }
    })
    .sort((left, right) => {
      const leftExact = left.descriptor.shape[0] === requiredVocabSize ? 0 : 1
      const rightExact = right.descriptor.shape[0] === requiredVocabSize ? 0 : 1
      return leftExact - rightExact || left.descriptor.shape[0] - right.descriptor.shape[0]
    })

  const selected = candidates[0]
  if (selected === undefined) {
    throw new TypeError(
      `no safetensors matrix has ${MODEL_DIMENSION} columns and at least ${requiredVocabSize} rows`,
    )
  }

  const { dtype, shape, dataOffsets } = selected.descriptor
  const elementBytes = dtypeBytes(dtype)
  const elementCount = shape[0] * shape[1]
  if (!Number.isSafeInteger(elementCount)) throw new TypeError('embedding matrix is too large')
  const expectedByteLength = elementCount * elementBytes
  const [relativeStart, relativeEnd] = dataOffsets
  if (relativeEnd < relativeStart || relativeEnd - relativeStart !== expectedByteLength) {
    throw new TypeError(`safetensors tensor ${selected.name} byte length does not match its shape`)
  }
  const absoluteStart = dataStart + relativeStart
  const absoluteEnd = dataStart + relativeEnd
  if (absoluteStart < dataStart || absoluteEnd > bytes.byteLength) {
    throw new TypeError(`safetensors tensor ${selected.name} offsets exceed the file length`)
  }

  const readValue = makeValueReader(bytes, absoluteStart, dtype)
  return {
    tensorName: selected.name,
    dtype,
    rows: shape[0],
    columns: shape[1],
    valueAt(row, column) {
      if (row < 0 || row >= shape[0] || column < 0 || column >= shape[1]) {
        throw new RangeError(`embedding matrix coordinate is out of range: ${row},${column}`)
      }
      const value = readValue(row * shape[1] + column)
      if (!Number.isFinite(value)) {
        throw new TypeError(`embedding matrix contains a non-finite value at ${row},${column}`)
      }
      return value
    },
  }
}

function tokenizerVocabSize(tokenizer: Tokenizer): number {
  const ids = [...tokenizer.get_vocab(true).values()]
  if (ids.length === 0) throw new TypeError('tokenizer vocabulary is empty')
  const maximumId = Math.max(...ids)
  if (!Number.isSafeInteger(maximumId) || maximumId < 0) {
    throw new TypeError('tokenizer vocabulary contains an invalid token id')
  }
  return maximumId + 1
}

function quantizeMatrix(matrix: SafetensorsMatrix): Buffer {
  const scaleOffset = 16
  const valuesOffset = scaleOffset + matrix.rows * Float32Array.BYTES_PER_ELEMENT
  const outputLength = valuesOffset + matrix.rows * matrix.columns
  if (!Number.isSafeInteger(outputLength)) throw new TypeError('floor artifact is too large')

  const output = Buffer.allocUnsafe(outputLength)
  output.write(FLOOR_MAGIC, 0, 'ascii')
  output.writeUInt32LE(FLOOR_FORMAT_VERSION, 4)
  output.writeUInt32LE(matrix.rows, 8)
  output.writeUInt32LE(matrix.columns, 12)

  for (let row = 0; row < matrix.rows; row += 1) {
    let maximumAbsoluteValue = 0
    for (let column = 0; column < matrix.columns; column += 1) {
      maximumAbsoluteValue = Math.max(maximumAbsoluteValue, Math.abs(matrix.valueAt(row, column)))
    }
    const scale = maximumAbsoluteValue === 0 ? 1 : maximumAbsoluteValue / 127
    output.writeFloatLE(scale, scaleOffset + row * Float32Array.BYTES_PER_ELEMENT)
    const rowOffset = valuesOffset + row * matrix.columns
    for (let column = 0; column < matrix.columns; column += 1) {
      const quantized = Math.max(
        -127,
        Math.min(127, Math.round(matrix.valueAt(row, column) / scale)),
      )
      output.writeInt8(quantized, rowOffset + column)
    }
  }
  return output
}

function referenceEmbedding(
  tokenizer: Tokenizer,
  matrix: SafetensorsMatrix,
  text: string,
): number[] {
  const tokenIds = tokenizer.encode(text, { add_special_tokens: false }).ids
  if (tokenIds.length === 0) throw new TypeError(`golden text produced no tokens: ${text}`)

  const vector = new Float64Array(matrix.columns)
  for (const tokenId of tokenIds) {
    if (!Number.isSafeInteger(tokenId) || tokenId < 0 || tokenId >= matrix.rows) {
      throw new RangeError(`token id ${tokenId} is outside the embedding matrix`)
    }
    for (let column = 0; column < matrix.columns; column += 1) {
      vector[column] = vector[column]! + matrix.valueAt(tokenId, column)
    }
  }

  let squaredLength = 0
  for (let column = 0; column < vector.length; column += 1) {
    const mean = vector[column]! / tokenIds.length
    vector[column] = mean
    squaredLength += mean * mean
  }
  const length = Math.sqrt(squaredLength)
  if (!Number.isFinite(length) || length === 0) {
    throw new TypeError(`golden text produced a zero or non-finite vector: ${text}`)
  }
  return Array.from(vector, (value) => Math.fround(value / length))
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fileManifestEntry(path: string): Promise<FileManifestEntry> {
  const bytes = await readFile(path)
  return { bytes: bytes.byteLength, sha256: sha256(bytes) }
}

async function main(): Promise<void> {
  const { outDir } = parseArgs(process.argv.slice(2))
  const cacheDir = await mkdtemp(join(tmpdir(), 'agent-qa-embedding-floor-'))
  const modelPath = join(cacheDir, 'model.safetensors')
  const tokenizerPath = join(cacheDir, TOKENIZER_FILE)

  try {
    await Promise.all([
      download(modelFileUrl('model.safetensors'), modelPath),
      download(modelFileUrl(TOKENIZER_FILE), tokenizerPath),
    ])

    const tokenizerBytes = await readFile(tokenizerPath)
    const tokenizerJson: unknown = JSON.parse(tokenizerBytes.toString('utf8'))
    if (!isRecord(tokenizerJson)) throw new TypeError('tokenizer.json must contain an object')
    const tokenizer = new Tokenizer(tokenizerJson, {})
    const matrix = parseEmbeddingMatrix(await readFile(modelPath), tokenizerVocabSize(tokenizer))
    if (matrix.columns !== MODEL_DIMENSION) {
      throw new TypeError(`expected embedding dimension ${MODEL_DIMENSION}, got ${matrix.columns}`)
    }

    await mkdir(outDir, { recursive: true })
    const binaryPath = join(outDir, BINARY_FILE)
    const outputTokenizerPath = join(outDir, TOKENIZER_FILE)
    const goldenPath = join(outDir, GOLDEN_FILE)
    const manifestPath = join(outDir, MANIFEST_FILE)

    await writeFile(binaryPath, quantizeMatrix(matrix))
    await copyFile(tokenizerPath, outputTokenizerPath)
    await writeFile(
      goldenPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          modelId: MODEL_ID,
          revision: MODEL_REVISION,
          dimension: matrix.columns,
          cases: GOLDEN_TEXTS.map((text) => ({
            text,
            vector: referenceEmbedding(tokenizer, matrix, text),
          })),
        },
        null,
        2,
      )}\n`,
    )

    const files = {
      [BINARY_FILE]: await fileManifestEntry(binaryPath),
      [TOKENIZER_FILE]: await fileManifestEntry(outputTokenizerPath),
      [GOLDEN_FILE]: await fileManifestEntry(goldenPath),
    }
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          format: 'potion-static-int8',
          modelId: MODEL_ID,
          revision: MODEL_REVISION,
          source: {
            model: modelFileUrl('model.safetensors'),
            tokenizer: modelFileUrl(TOKENIZER_FILE),
            tensorName: matrix.tensorName,
            tensorDtype: matrix.dtype,
            tensorShape: [matrix.rows, matrix.columns],
          },
          artifact: {
            magic: FLOOR_MAGIC,
            version: FLOOR_FORMAT_VERSION,
            vocabularySize: matrix.rows,
            dimension: matrix.columns,
            quantization: 'symmetric-per-row-int8',
          },
          files,
        },
        null,
        2,
      )}\n`,
    )

    process.stdout.write(`wrote ${relative(process.cwd(), outDir) || '.'}\n`)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
}

await main()
