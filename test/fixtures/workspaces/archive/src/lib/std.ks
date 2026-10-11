// Standard library, loaded by the boot loader before every mission.
@lazyglobal off.

// Print a status line at the bottom of the terminal.
function print_status {
    parameter message.
    print "STATUS: " + message at (0, terminal:height - 1).
}
