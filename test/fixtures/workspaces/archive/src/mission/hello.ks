@lazyglobal off.
runoncepath("0:/src/lib/state").

local step is state_get("step", 0).
if step = 0 {
    print_status("hello").
    state_set("step", 1).
}
if stage:ready {
    print ship:stagedeltav(ship:stagenum):current.
}
