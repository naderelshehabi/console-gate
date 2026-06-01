package com.consolegate.shared;

import static com.consolegate.shared.TestHarness.*;

public final class JsonTest {
  public static void run() {
    Object root = Json.parse("{\"a\":1,\"b\":\"hi\",\"c\":true,\"d\":null,\"arr\":[1,2,3],\"o\":{\"x\":-4.5}}");
    check(Json.obj(root) != null, "parses object");
    eqi((long) Json.getNum(root, "a", -1), 1, "number a");
    eq(Json.getStr(root, "b", ""), "hi", "string b");
    check(Json.bool(Json.get(root, "c"), false), "bool c");
    check(Json.get(root, "d") == null, "null d");
    eqi(Json.arr(Json.get(root, "arr")).size(), 3, "array len");
    check(Json.getNum(Json.get(root, "o"), "x", 0) < -4.0, "nested number");

    // escapes
    Object s = Json.parse("\"a\\nb\\t\\\"q\\\"\"");
    eq(s, "a\nb\t\"q\"", "string escapes");

    // malformed -> null
    check(Json.parse("{") == null, "incomplete object");
    check(Json.parse("[1,2") == null, "incomplete array");
    check(Json.parse("{\"a\":1} junk") == null, "trailing garbage");
    check(Json.parse("") == null, "empty");
    check(Json.parse(null) == null, "null input");
  }
}
