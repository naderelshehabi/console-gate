package com.consolegate.shared;

import static com.consolegate.shared.TestHarness.*;

import java.util.List;

public final class ModelsTest {
  public static void run() {
    // A realistic GET /consoles response.
    String consoles =
        "{\"consoles\":[" +
        "{\"console\":{\"id\":\"c1\",\"name\":\"Den 360\",\"kind\":\"xbox360\",\"lastSeen\":1700000000000}," +
        "\"effective\":{\"state\":\"WARNING\",\"reason\":\"quota-end\",\"quotaRemainingMin\":5,\"enforcement\":\"hard\"}," +
        "\"quota\":{\"minutesUsed\":115,\"quotaTotalMin\":120}}," +
        "{\"console\":{\"id\":\"c2\",\"name\":\"Wii\",\"kind\":\"wii\",\"lastSeen\":null}," +
        "\"effective\":{\"state\":\"LOCKED\",\"reason\":\"outside-window\",\"quotaRemainingMin\":0,\"enforcement\":\"hard\"}," +
        "\"quota\":{\"minutesUsed\":0,\"quotaTotalMin\":90}}]}";
    List<HubModels.ConsoleView> list = HubModels.parseConsoles(consoles);
    eqi(list.size(), 2, "two consoles");
    HubModels.ConsoleView a = list.get(0);
    eq(a.id, "c1", "id");
    eq(a.name, "Den 360", "name");
    eq(a.kind, "xbox360", "kind");
    eq(a.state, "WARNING", "state");
    eqi(a.quotaRemainingMin, 5, "remaining");
    eqi(a.minutesUsed, 115, "used");
    eqi(a.quotaTotalMin, 120, "total");
    eqi(a.lastSeen, 1700000000000L, "lastSeen");
    check(!a.isLocked(), "not locked");

    HubModels.ConsoleView b = list.get(1);
    check(b.isLocked(), "locked");
    check(b.lastSeen == null, "never seen");

    // Empty / malformed.
    eqi(HubModels.parseConsoles("{}").size(), 0, "no consoles key");
    eqi(HubModels.parseConsoles("garbage").size(), 0, "garbage");

    // Login parsing.
    HubModels.Login login = HubModels.parseLogin("{\"deviceToken\":\"tok\",\"pinSession\":\"sess\",\"expires\":1}");
    check(login != null, "login parsed");
    eq(login.deviceToken, "tok", "token");
    eq(login.pinSession, "sess", "pin session");
    check(HubModels.parseLogin("{\"error\":\"bad\"}") == null, "no token -> null");

    // Stream message kind.
    eq(HubModels.streamMessageKind("{\"kind\":\"event\",\"event\":{}}"), "event", "stream kind");
    eq(HubModels.streamMessageKind("{\"kind\":\"state\"}"), "state", "stream state kind");
  }
}
