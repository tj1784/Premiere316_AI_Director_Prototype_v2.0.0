export const DIRECTOR_REPOSITORY_URL = "https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI";

export type DirectorRuntimeStatus = {
  status: "AVAILABLE_IN_COMFYUI" | "NODE_MISSING" | "OFFLINE";
  message: string;
  endpoint: string | null;
  checkedAt: number;
  missingNodes: string[];
  appRenderingConnected: false;
  workflowModelsVerified: false;
};
