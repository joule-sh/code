export type TaskRunner = {
  startBackgroundRun: (command: string) => string,
  startSubagent: (task: string) => string,
  taskStatus: (id: string) => string,
};

export type ApprovalResponder = {
  hasPendingApproval: () => bool,
  answerActiveApproval: (decision: string) => void,
  activeApprovalTool: () => string,
  activeApprovalSelected: () => int,
  activeApprovalHasOptionRows: () => bool,
  activeApprovalOptionRows: () => int,
  moveActiveApprovalSelection: (delta: int, count: int) => bool,
};
