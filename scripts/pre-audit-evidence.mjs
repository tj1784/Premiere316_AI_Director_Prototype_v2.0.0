// Release evidence only; this adds no application gate or mode.
export function livePackagedUatPassed(report) {
  return report?.ok === true && report.skipped === false && report.packaged === true
    && report.onlineVerified === true && report.actualProviderCalls >= 8
    && report.researchGenerated === true && report.screenplayGenerated === true
    && report.qaGenerated === true && report.assetsExtracted === true
    && report.noSilentFallback === true && report.network?.verified === true
    && ["cloud", "web", "comfy", "port8188"].every((key) => report.network[key] === 0);
}
