import { memoryFilePath, addMemoryEntryText, removeMemoryEntryAt, clearMemoryFile, listMemoryText, loadUserMemoryText } from "../session/memory.ts";

const MEMORY_USAGE: string = "\nusage: /memory, /memory add <text>, /memory forget <n>, or /memory clear";

function forgetArg(arg: string): string {
  if (!arg.startsWith("forget ")) { return ""; }
  return arg.slice(7, arg.length).trim();
}

export function memoryCommandText(arg: string): string {
  let file = memoryFilePath();

  if (arg == "" || arg == "list") {
    return listMemoryText(file);
  }

  if (arg.startsWith("add ")) {
    let r = addMemoryEntryText(file, arg.slice(4, arg.length));
    return "\n" + r.message;
  }

  let forgetIndex = forgetArg(arg);
  if (forgetIndex != "") {
    let n = Number.parseInt(forgetIndex, 10) ?? -1;
    if (n <= 0) {
      return "\nusage: /memory forget <n>, where <n> is a number from /memory list";
    }
    if (removeMemoryEntryAt(file, n)) {
      return "\nforgot entry " + `${n}` + ".";
    }
    return "\nno entry " + `${n}` + " to forget.";
  }

  if (arg == "clear") {
    clearMemoryFile(file);
    return "\ncleared everything joule remembers about you.";
  }

  return MEMORY_USAGE;
}

export function startupMemoryText(): string {
  return loadUserMemoryText(memoryFilePath());
}
