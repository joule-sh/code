export const BOX_PROMPT_ROWS: int = 3;
export const PLAIN_PROMPT_ROWS: int = 1;

export const MIN_ROWS_FOR_BOX: int = 12;

export function promptRowCount(termRows: int): int {
  if (termRows >= MIN_ROWS_FOR_BOX) { return BOX_PROMPT_ROWS; }
  return PLAIN_PROMPT_ROWS;
}

export function usesBox(termRows: int): bool {
  return promptRowCount(termRows) == BOX_PROMPT_ROWS;
}
