# Example: Find a stable base / pointer chain

Goal: turn a dynamic heap address into a stable `module base + offset` style pointer chain.

## Steps

1. First get a usable dynamic address (see `find_value.md`).

2. Scan upward for pointers to that address

   ```
   ce_pointer_scan { address: "0x...", max_depth: 3, max_results: 20 }
   ```

   The result is a list of chains from parent pointers to the target.

3. For each promising chain, verify with a pointer-chain read

   ```
   ce_read_pointer_chain { base: "0xMODULE_BASE", offsets: [0x10, 0x20] }
   ```

4. If the chain reads back the same value, test writing through the chain.

5. If no chain reaches a module base within 5 levels, report: likely no stable base.

## Notes

- Pointer chains are often dynamic; a "stable" chain usually ends at a module base such as `GameAssembly.dll` or the main EXE.
- Use `ce_enum_modules` / `ce_process_info` to get module bases.
