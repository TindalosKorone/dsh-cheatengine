# Example: Find a changing value

Goal: locate the memory address that controls a changing in-game value.

## Steps

1. Connect and confirm environment

   ```
   ce_connect
   ce_process_info
   ce_detect_engine
   ```

2. First scan (only returns count)

   ```
   ce_scan { value: "323", type: "dword", protection: "+R" }
   ```

   If the count is huge, retry with `float`, `double`, `word`, or `qword`.

3. Ask the user to change the value in-game, then filter

   ```
   ce_next_scan { value: "320", scan_type: "exact" }
   ```

   If the value only goes down/up, you can use `increased` / `decreased`.

4. When the count is small (e.g., 1-10), read the candidates

   ```
   ce_get_scan_results { limit: 20 }
   ```

5. Verify by reading and writing

   ```
   ce_read_integer  { address: "0x...", type: "dword" }
   ce_write_integer { address: "0x...", value: 999, type: "dword" }
   ```

   Ask the user if the game display changed.

6. If direct write does NOT change the game, it is likely a display copy. Use:

   ```
   ce_find_what_writes { address: "0x...", timeout_ms: 15000 }
   ```

   Then follow the write instruction to find the real source.

## Stop conditions

- If all common types return 0, stop and report: the value is probably not a plain memory integer/float.
- If write does not affect the game and no write instruction is found, report: likely server-side or protected.
