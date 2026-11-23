// Lets `node --test` load app modules that use Next-style imports:
// extensionless relative paths ("./db") and the "@/..." alias. Node's type
// stripping runs the .ts itself; this hook only finds the file.
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
