# ConsoleGate Xbox 360 agent.
#
# The real plugin (cg_agent.xex) is built with the Microsoft Xbox 360 XDK (XeDK)
# and its Visual Studio integration, with _XBOX defined — that toolchain is not a
# plain Make/gcc build and is not present in CI.
#
# `make check` host-compiles the NON-XDK code paths (platform code is under
# #ifdef _XBOX) against agent-core, to catch integration/type errors early.

CC ?= gcc
CFLAGS ?= -std=c99 -Wall -Wextra -I../agent-core/include -Iplugin
BUILD = build

.PHONY: check clean
check:
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -c plugin/main.c -o $(BUILD)/main.o
	$(CC) $(CFLAGS) -c plugin/net.c  -o $(BUILD)/net.o
	@echo "host compile-check OK (non-XDK paths)"

clean:
	rm -rf $(BUILD)
