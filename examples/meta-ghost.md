# Case Pack: Meta Ghost (Unity / IL2CPP)

This is a real-world case from debugging `Meta Ghost.exe` (Unity / IL2CPP, 64-bit).

## Environment

- Process: `Meta Ghost.exe`
- Engine: Unity (detected by `ce_detect_engine`)
- Key modules:
  - `Meta Ghost.exe`
  - `UnityPlayer.dll`
  - `GameAssembly.dll`
- Protection: none detected (`ce_detect_protection` returned `risk: none`)

## Key findings

### UI display copy problem

- The game shows values that are **copies**, not the real data.
- Scanning finds the display copy, but writing to it does NOT change the real value.
- Fix: use `ce_find_what_writes` on the display address to locate the UI write instruction, then hook the source buffer before it is copied.

### Resources found

| Resource | Type | Lock value | Notes |
|---|---|---|---|
| talentNum / 改造芯片 | dword | 999999 | UI display copy; real source found via write hook |
| 算力 | dword | 999999 | Direct write works |
| 特征筛选卡 | dword | 999999 | Direct write works |

### Useful AOB

The UI update instruction pattern used to hook value refreshes:

```
0F 10 03 4C 8B 8D 08 01 00 00 4C 8D 1D ?? ?? ?? ?? 4C 8B 95 00 01 00 00 0F 11 07
```

This pattern is used by the plugin to re-locate the hook address automatically.

## Playbook

Use `ce_playbook(task="find_value", engine="unity")` for a generic route. For this game, remember:

- Prefer `dword` for these resources.
- If a write does not change the game, it is a display copy; go to `ce_find_what_writes`.
- The same UI write instruction may update multiple resources (talentNum, 算力, 特征筛选卡).
