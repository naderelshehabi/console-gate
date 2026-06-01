# agent-core — portable C, shared by the Wii and Xbox 360 agents.
# `make test` builds and runs the host unit suite with the system C compiler.

CC ?= gcc
CFLAGS ?= -std=c99 -Wall -Wextra -O2 -Iinclude -Itest
SRC = src/cg_json.c src/cg_proto.c src/cg_agent.c src/cg_enforce.c src/cg_http.c src/cg_hmac.c src/cg_sign.c
TESTSRC = test/test_main.c test/test_json.c test/test_proto.c test/test_agent.c test/test_enforce.c test/test_http.c test/test_hmac.c
BUILD = build

.PHONY: test tool clean
test:
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) $(SRC) $(TESTSRC) -o $(BUILD)/cgtest
	$(BUILD)/cgtest

# Cross-language check tool: parses a Hub /agent/poll response from stdin.
tool:
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) $(SRC) tools/cg_parse_tool.c -o $(BUILD)/cg_parse_tool

clean:
	rm -rf $(BUILD)
