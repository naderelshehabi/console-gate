package com.consolegate.shared;

/** A resolved Hub endpoint plus how it was found. */
public final class Endpoint {
  public enum Source { MDNS, UDP_BROADCAST, CACHE, MANUAL }

  public final String host;
  public final int port;
  public final Source source;

  public Endpoint(String host, int port, Source source) {
    this.host = host;
    this.port = port;
    this.source = source;
  }

  public String baseUrl() {
    return "http://" + host + ":" + port + "/api/v1";
  }

  /** Parse a UDP discovery reply ({"hubId":...,"port":N,...}) sent from senderHost. */
  public static Endpoint fromDiscoveryReply(String json, String senderHost) {
    Object root = Json.parse(json);
    if (Json.obj(root) == null) return null;
    int port = (int) Json.getNum(root, "port", -1);
    if (port <= 0 || senderHost == null || senderHost.isEmpty()) return null;
    return new Endpoint(senderHost, port, Source.UDP_BROADCAST);
  }

  @Override
  public boolean equals(Object o) {
    if (!(o instanceof Endpoint)) return false;
    Endpoint e = (Endpoint) o;
    return port == e.port && host.equals(e.host) && source == e.source;
  }

  @Override
  public int hashCode() {
    return host.hashCode() * 31 + port;
  }

  @Override
  public String toString() {
    return source + ":" + host + ":" + port;
  }
}
