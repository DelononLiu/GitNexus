export interface AcpMessageHandler {
  onText: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (toolCallId: string, title: string, kind: string, status: string) => void;
  onToolCallUpdate?: (toolCallId: string, status: string, content?: string, title?: string, kind?: string) => void;
  onPlan?: (entries: { content: string; priority: string; status: string }[]) => void;
  onError: (error: string) => void;
  onDone: (stopReason?: string) => void;
}

export interface FileChange {
  filePath: string;
  original: string;
  modified: string;
}
