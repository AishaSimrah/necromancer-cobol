# Verified outputs from GnuCOBOL 3.1.2 (the "oracle")

Compile: `cobc -x -free -o <name> <name>.cbl`
Run: pipe each input on its own line to stdin.

## interest.cbl (inputs: principal, rate %, years)
| Input | Output |
|---|---|
| 1000 / 5 / 3 | `BALANCE:    1157.63` |
| 1234.56 / 7.25 / 10 | `BALANCE:    2485.95` |
| 9000000 / 50 / 3 | `BALANCE: 7875000.00`  (overflow trap: the true value is 30,375,000, but high-order digits are dropped each year) |

## payroll.cbl (inputs: hours, hourly rate)
| Input | Output |
|---|---|
| 45 / 20.55 | `GROSS:    976.13` `DEDUCT:     74.67` `NET:    901.46` |
| 32.5 / 18.99 | `GROSS:    617.18` `DEDUCT:     47.21` `NET:    569.97` |

Trap: DEDUCT is 7.65% of gross and is truncated (no ROUNDED). 976.13 x 0.0765 = 74.673..., stored as 74.67.

## tax.cbl (input: annual income)
| Input | Output |
|---|---|
| 300000 | `TAX:     2500` |
| 750000 | `TAX:    62500` |
| 2000000 | `TAX:   412500` |

## Why these are good demo programs
- interest: shows per-iteration rounding and silent overflow.
- payroll: shows overtime branching and truncation vs ROUNDED.
- tax: shows progressive brackets, where a naive "rate x income" translation is wrong.
