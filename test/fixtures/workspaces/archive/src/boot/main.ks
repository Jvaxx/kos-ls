// Boot loader: loads the standard library from the ship's disk, then the
// mission named by the core's tag.
@lazyglobal off.

local mission is core:part:tag.

if exists("1:/lib/std.ks") {
    runoncepath("1:/lib/std.ks").
    print_status("booting " + mission).
}

local main is "1:/mission/" + mission + ".ks".
if exists(main) {
    runpath(main).
}
