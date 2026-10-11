// Mission state that survives reboots.
@lazyglobal off.

function state_get {
    parameter key, default.
    return default.
}

function state_set {
    parameter key, value.
    print key + " = " + value.
}
