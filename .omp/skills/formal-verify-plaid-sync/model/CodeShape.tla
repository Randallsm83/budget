----------------------------- MODULE CodeShape -----------------------------
\* Written by check.sh from the source files. Do not edit by hand:
\* run check.sh, and copy its CodeShape.tla here once you agree with it.
ApplySteps == <<"insert", "update", "delete", "cursor">>
OnConflict == "nothing"
RepairSteps == <<"load", "wipe", "reset", "sync">>
ClearSteps == <<"wipe">>
=============================================================================
