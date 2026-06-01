package com.consolegate.shared;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal, dependency-free JSON reader for the shared client logic. Parses to
 * Map&lt;String,Object&gt; / List&lt;Object&gt; / String / Double / Boolean / null.
 *
 * Pure JVM (no Android, no third-party libs) so it compiles and unit-tests with
 * a plain JDK. The Android app may use this or a richer library; the contract it
 * parses is locked by the Hub test suite.
 */
public final class Json {
  private final String s;
  private int i;

  private Json(String s) {
    this.s = s;
  }

  /** Parse a JSON document. Returns null on malformed input. */
  public static Object parse(String text) {
    if (text == null) return null;
    try {
      Json p = new Json(text);
      p.ws();
      Object v = p.value();
      p.ws();
      if (p.i != p.s.length()) return null; // trailing garbage
      return v;
    } catch (RuntimeException e) {
      return null;
    }
  }

  // --- typed convenience accessors ---------------------------------------

  @SuppressWarnings("unchecked")
  public static Map<String, Object> obj(Object o) {
    return (o instanceof Map) ? (Map<String, Object>) o : null;
  }

  @SuppressWarnings("unchecked")
  public static List<Object> arr(Object o) {
    return (o instanceof List) ? (List<Object>) o : null;
  }

  public static Object get(Object o, String key) {
    Map<String, Object> m = obj(o);
    return m == null ? null : m.get(key);
  }

  public static String str(Object o, String fallback) {
    return (o instanceof String) ? (String) o : fallback;
  }

  public static double num(Object o, double fallback) {
    return (o instanceof Number) ? ((Number) o).doubleValue() : fallback;
  }

  public static long lng(Object o, long fallback) {
    return (o instanceof Number) ? ((Number) o).longValue() : fallback;
  }

  public static boolean bool(Object o, boolean fallback) {
    return (o instanceof Boolean) ? (Boolean) o : fallback;
  }

  public static String getStr(Object o, String key, String fallback) {
    return str(get(o, key), fallback);
  }

  public static double getNum(Object o, String key, double fallback) {
    return num(get(o, key), fallback);
  }

  // --- parser ------------------------------------------------------------

  private void ws() {
    while (i < s.length()) {
      char c = s.charAt(i);
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
      else break;
    }
  }

  private Object value() {
    ws();
    if (i >= s.length()) throw new RuntimeException("eof");
    char c = s.charAt(i);
    switch (c) {
      case '{': return object();
      case '[': return array();
      case '"': return string();
      case 't': expect("true"); return Boolean.TRUE;
      case 'f': expect("false"); return Boolean.FALSE;
      case 'n': expect("null"); return null;
      default: return number();
    }
  }

  private void expect(String lit) {
    if (!s.startsWith(lit, i)) throw new RuntimeException("expected " + lit);
    i += lit.length();
  }

  private Map<String, Object> object() {
    Map<String, Object> m = new LinkedHashMap<>();
    i++; // {
    ws();
    if (peek() == '}') { i++; return m; }
    while (true) {
      ws();
      if (peek() != '"') throw new RuntimeException("expected key");
      String key = string();
      ws();
      if (peek() != ':') throw new RuntimeException("expected :");
      i++;
      Object v = value();
      m.put(key, v);
      ws();
      char c = peek();
      if (c == ',') { i++; continue; }
      if (c == '}') { i++; return m; }
      throw new RuntimeException("expected , or }");
    }
  }

  private List<Object> array() {
    List<Object> l = new ArrayList<>();
    i++; // [
    ws();
    if (peek() == ']') { i++; return l; }
    while (true) {
      l.add(value());
      ws();
      char c = peek();
      if (c == ',') { i++; continue; }
      if (c == ']') { i++; return l; }
      throw new RuntimeException("expected , or ]");
    }
  }

  private String string() {
    StringBuilder sb = new StringBuilder();
    i++; // opening quote
    while (i < s.length()) {
      char c = s.charAt(i++);
      if (c == '"') return sb.toString();
      if (c == '\\') {
        char e = s.charAt(i++);
        switch (e) {
          case '"': sb.append('"'); break;
          case '\\': sb.append('\\'); break;
          case '/': sb.append('/'); break;
          case 'n': sb.append('\n'); break;
          case 't': sb.append('\t'); break;
          case 'r': sb.append('\r'); break;
          case 'b': sb.append('\b'); break;
          case 'f': sb.append('\f'); break;
          case 'u':
            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
            i += 4;
            break;
          default: sb.append(e);
        }
      } else {
        sb.append(c);
      }
    }
    throw new RuntimeException("unterminated string");
  }

  private Object number() {
    int start = i;
    while (i < s.length()) {
      char c = s.charAt(i);
      if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') i++;
      else break;
    }
    if (i == start) throw new RuntimeException("bad number");
    return Double.parseDouble(s.substring(start, i));
  }

  private char peek() {
    if (i >= s.length()) throw new RuntimeException("eof");
    return s.charAt(i);
  }
}
