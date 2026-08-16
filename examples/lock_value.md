# Example: Lock a value (infinite resource)

Goal: keep an address at a fixed value so it never decreases.

## Steps

1. Confirm the address and current value

   ```
   ce_read_integer { address: "0x...", type: "dword" }
   ```

2. Lock it

   ```
   ce_lock_address { address: "0x...", value: 999999, type: "dword", interval_ms: 100 }
   ```

3. Verify it stays locked

   ```
   ce_read_integer { address: "0x...", type: "dword" }
   ce_session_stats
   ```

4. If you need to unlock later

   ```
   ce_unlock_address { address: "0x..." }
   ```

## Notes

- `ce_lock_address` uses a periodic write-back timer inside CE.
- If the address is a display copy, locking it may only freeze the UI, not the real value.
- Use `ce_find_what_writes` first if you are unsure whether the address is the real source.
