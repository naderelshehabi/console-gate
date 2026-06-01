package com.consolegate.shared;

import java.util.ArrayList;
import java.util.List;

/**
 * Parsers + DTOs for the Hub responses the Android app reads. Pure JVM, so they
 * unit-test without Android. The response shapes are locked by the Hub test
 * suite (see hub/src/api/agent-contract.test.ts for the agent side; the
 * controller shapes are exercised in api.test.ts / web.test.ts).
 */
public final class HubModels {

  public static final class ConsoleView {
    public final String id;
    public final String name;
    public final String kind;       // xbox360 | wii
    public final String state;      // ALLOWED | WARNING | GRACE | LOCKED
    public final String reason;
    public final int quotaRemainingMin;
    public final int minutesUsed;
    public final int quotaTotalMin;
    public final Long lastSeen;      // null = never

    ConsoleView(String id, String name, String kind, String state, String reason,
                int quotaRemainingMin, int minutesUsed, int quotaTotalMin, Long lastSeen) {
      this.id = id;
      this.name = name;
      this.kind = kind;
      this.state = state;
      this.reason = reason;
      this.quotaRemainingMin = quotaRemainingMin;
      this.minutesUsed = minutesUsed;
      this.quotaTotalMin = quotaTotalMin;
      this.lastSeen = lastSeen;
    }

    public boolean isLocked() { return "LOCKED".equals(state); }
  }

  public static final class Login {
    public final String deviceToken;
    public final String pinSession;
    Login(String deviceToken, String pinSession) {
      this.deviceToken = deviceToken;
      this.pinSession = pinSession;
    }
  }

  /** Parse GET /consoles -> list of console cards. Returns empty list on bad input. */
  public static List<ConsoleView> parseConsoles(String json) {
    List<ConsoleView> out = new ArrayList<>();
    Object root = Json.parse(json);
    List<Object> arr = Json.arr(Json.get(root, "consoles"));
    if (arr == null) return out;
    for (Object item : arr) {
      Object con = Json.get(item, "console");
      Object eff = Json.get(item, "effective");
      Object q = Json.get(item, "quota");
      Object lastSeenRaw = Json.get(con, "lastSeen");
      Long lastSeen = (lastSeenRaw instanceof Number) ? ((Number) lastSeenRaw).longValue() : null;
      out.add(new ConsoleView(
          Json.getStr(con, "id", ""),
          Json.getStr(con, "name", ""),
          Json.getStr(con, "kind", ""),
          Json.getStr(eff, "state", ""),
          Json.getStr(eff, "reason", ""),
          (int) Json.getNum(eff, "quotaRemainingMin", 0),
          (int) Json.getNum(q, "minutesUsed", 0),
          (int) Json.getNum(q, "quotaTotalMin", 0),
          lastSeen));
    }
    return out;
  }

  /** Parse POST /web/login. Returns null if the token is absent. */
  public static Login parseLogin(String json) {
    Object root = Json.parse(json);
    String token = Json.getStr(root, "deviceToken", null);
    if (token == null) return null;
    return new Login(token, Json.getStr(root, "pinSession", null));
  }

  /** Whether a stream message (from WS) is an event that should refresh the UI. */
  public static String streamMessageKind(String json) {
    return Json.getStr(Json.parse(json), "kind", "");
  }
}
