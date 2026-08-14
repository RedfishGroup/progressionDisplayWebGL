# legacy/

The original renderer this repo shipped before the core rebuild (see `.ai/step-4-implementation-plan-core-rebuild.md` in the workspace root). Parked here as reference while the consuming apps migrate: AnyHazard's `Simtable2/src/UI/webgl/` is a line-for-line fork of these files, so diffing against them answers porting questions. Nothing should import from this directory except the interim demo; these files are deleted in the cleanup step once all hosts are on the new core.
