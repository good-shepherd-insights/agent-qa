// D-11 keeps native-extension package resolution behind one internal boundary.
// index-open consumes this named export and remains responsible for load failures.
export { getLoadablePath } from 'sqlite-vec'
