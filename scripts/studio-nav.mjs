const DEFAULT_BUTTON = {
  intake: "01 Intake",
  "asset-approval": "02 Assets",
  "keyframe-approval": "03 First / Last",
  "video-approval": "04 Video Clips",
  export: "05 Export",
};

const ADVANCED_OPEN = {
  research: "Open Research",
  screenplay: "Open Screenplay",
  inventory: "Open Inventory",
  "visual-development": "Open Visual Development",
  cinematography: "Open Cinematography",
  performance: "Open Performance",
  shots: "Open Shots",
  prompts: "Open Prompt Lab",
  review: "Open Review",
  timeline: "Open Stitch",
  score: "Open Score",
  export: "Open Diagnostics / Export internals",
};

const ADVANCED_NAV = {
  research: "Research",
  screenplay: "Screenplay",
  inventory: "Inventory",
  "visual-development": "Visual Development",
  cinematography: "Cinematography",
  performance: "Performance",
  shots: "Shots",
  prompts: "Prompt Lab",
  review: "Review",
  timeline: "Stitch",
  score: "Score",
  export: "Diagnostics / Export internals",
};

export async function returnToDefaultMode(page) {
  const button = page.getByRole("button", { name: "Return to Default Mode" });
  if (await button.isVisible().catch(() => false)) await button.click();
  await page.locator('[data-studio-shell="true"][data-ui-mode="default"]').waitFor();
}

export async function enterAdvancedDepartments(page) {
  const button = page.getByRole("button", { name: "Advanced Departments" });
  if (await button.isVisible().catch(() => false)) await button.click();
  await page.locator('[data-studio-shell="true"][data-ui-mode="advanced"]').waitFor();
}

async function clickDefaultTouchpoint(page, name, value) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name, exact: true });
  if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
  else await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(value);
}

export async function selectStudioStage(page, stageId, options = {}) {
  const gate = options.gate;
  if (stageId === "intake") {
    await returnToDefaultMode(page).catch(() => {});
    await clickDefaultTouchpoint(page, DEFAULT_BUTTON.intake, "intake");
    await page.locator('[data-studio-shell="true"][data-stage="intake"][data-ui-mode="default"]').waitFor();
    return;
  }
  if (stageId === "generate") {
    await returnToDefaultMode(page).catch(() => {});
    const touch = gate === "video" ? "video-approval" : gate === "keyframes" ? "keyframe-approval" : "asset-approval";
    await clickDefaultTouchpoint(page, DEFAULT_BUTTON[touch], touch);
    await page.locator('[data-studio-shell="true"][data-stage="generate"][data-ui-mode="default"]').waitFor();
    return;
  }
  if (stageId === "export" && options.mode === "default") {
    await returnToDefaultMode(page).catch(() => {});
    await clickDefaultTouchpoint(page, DEFAULT_BUTTON.export, "export");
    await page.locator('[data-studio-shell="true"][data-stage="export"][data-ui-mode="default"]').waitFor();
    return;
  }

  await enterAdvancedDepartments(page);
  const dashboard = page.locator("[data-advanced-dashboard]");
  if (await dashboard.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: ADVANCED_OPEN[stageId], exact: true }).click();
  } else {
    const navigation = page.getByRole("navigation", { name: "Pipeline" });
    const wideButton = navigation.getByRole("button", { name: ADVANCED_NAV[stageId], exact: true });
    if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
    else await navigation.getByRole("combobox", { name: "Advanced department" }).selectOption(stageId);
  }
  await page.waitForFunction((id) => {
    const shell = document.querySelector("[data-studio-shell='true']");
    return shell?.getAttribute("data-stage") === id && shell.getAttribute("data-advanced-surface") === id && shell.getAttribute("data-ui-mode") === "advanced";
  }, stageId);
}
