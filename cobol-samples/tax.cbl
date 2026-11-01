       >>SOURCE FORMAT FREE
IDENTIFICATION DIVISION.
PROGRAM-ID. TAXCALC.
*> Progressive income tax with three brackets.
*> Traps for a naive translation:
*>   - tax applies only to the slice of income inside each bracket
*>   - EVALUATE TRUE picks the first matching branch
*>   - income is whole currency units; tax is rounded to whole units
DATA DIVISION.
WORKING-STORAGE SECTION.
01 WS-IN-INCOME      PIC X(20).
01 WS-INCOME         PIC 9(8).
01 WS-TAX            PIC 9(8).
01 WS-OUT            PIC Z(7)9.
PROCEDURE DIVISION.
MAIN-PARA.
    ACCEPT WS-IN-INCOME
    COMPUTE WS-INCOME = FUNCTION NUMVAL(WS-IN-INCOME)
    EVALUATE TRUE
        WHEN WS-INCOME <= 250000
            MOVE 0 TO WS-TAX
        WHEN WS-INCOME <= 500000
            COMPUTE WS-TAX ROUNDED = (WS-INCOME - 250000) * 0.05
        WHEN WS-INCOME <= 1000000
            COMPUTE WS-TAX ROUNDED = 12500 + (WS-INCOME - 500000) * 0.20
        WHEN OTHER
            COMPUTE WS-TAX ROUNDED = 112500 + (WS-INCOME - 1000000) * 0.30
    END-EVALUATE
    MOVE WS-TAX TO WS-OUT
    DISPLAY "TAX: " WS-OUT
    STOP RUN.
