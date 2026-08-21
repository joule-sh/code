export type TaskRunner = {
  startBackgroundRun: (command: string) => string,
  startSubagent: (task: string) => string,
};

export type ApprovalResponder = {
  hasPendingApproval: () => bool,
  answerActiveApproval: (decision: string) => void,
};
