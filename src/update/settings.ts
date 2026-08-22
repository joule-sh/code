export const UPDATE_CHECK_ENV: string = "JOULE_CODE_UPDATE_CHECK";

function isOffWord(word: string): bool {
  let text = word.trim().toLowerCase();
  return text == "off" || text == "0" || text == "false" || text == "no";
}

export function updateCheckDisabled(envValue: string, fileValue: string): bool {
  if (envValue.trim() != "") { return isOffWord(envValue); }
  if (fileValue.trim() != "") { return isOffWord(fileValue); }
  return false;
}
