# P0 full-app product-flow audit

Default user journey was 14 internal departments. Required touchpoints are only Intake, Assets, First/Last Frames, Video Clips, Export.

| Stage | Default? | Needed behavior | Fix |
|---|---|---|---|
| Intake | Yes | One-sentence brief + Build Movie Plan | Primary CTA + phase-review checkbox default OFF |
| Research | Advanced | Auto/fail-closed | Hidden unless Advanced or optional review |
| Screenplay | Advanced | Auto/fail-closed | Hidden unless Advanced |
| Inventory | Advanced | Auto extract | Hidden unless Advanced |
| Visual Dev | Advanced | Auto plan | Hidden unless Advanced |
| Cinematography | Advanced | Auto plan | Hidden unless Advanced |
| Performance | Advanced | Auto plan | Hidden unless Advanced |
| Shots | Advanced | Auto plan | Hidden unless Advanced |
| Prompt Lab | Advanced | Auto drafts | Hidden unless Advanced |
| Generate Assets | Yes | Required approval | Default nav 02 Assets |
| Generate Keyframes | Yes | Required approval | Default nav 03 |
| Generate Video | Yes | Required approval + import | Default nav 04 |
| Review | Advanced | Inspect takes | Deep link from Video |
| Stitch | Advanced | Auto assemble for export | Hidden unless Advanced |
| Score | Advanced | Import audio | Hidden unless Advanced |
| Export | Yes | Final CTA | Default nav 05 |

Llama offline: fail-closed recovery, do not dump blank Research/Screenplay as the default path.
