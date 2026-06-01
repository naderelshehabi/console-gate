package com.consolegate.shared;

import static com.consolegate.shared.TestHarness.*;

import java.util.ArrayList;
import java.util.List;

public final class DiscoveryTest {

  /** A scripted source: returns a fixed candidate (or null) on each call. */
  static final class FakeSource implements DiscoveryCoordinator.Source {
    final Endpoint.Source kind;
    final List<Endpoint> script;
    int calls = 0;
    FakeSource(Endpoint.Source kind, List<Endpoint> script) { this.kind = kind; this.script = script; }
    public Endpoint find() {
      Endpoint e = calls < script.size() ? script.get(calls) : null;
      calls++;
      return e;
    }
    public Endpoint.Source kind() { return kind; }
  }

  public static void run() {
    // Discovery-reply parsing.
    Endpoint ep = Endpoint.fromDiscoveryReply("{\"hubId\":\"x\",\"port\":8088,\"v\":1}", "192.168.1.5");
    check(ep != null, "discovery reply parsed");
    eq(ep.host, "192.168.1.5", "host from sender");
    eqi(ep.port, 8088, "port from json");
    eq(ep.source, Endpoint.Source.UDP_BROADCAST, "udp source");
    check(Endpoint.fromDiscoveryReply("{\"hubId\":\"x\"}", "1.2.3.4") == null, "no port -> null");
    eq(ep.baseUrl(), "http://192.168.1.5:8088/api/v1", "base url");

    Endpoint hub = new Endpoint("10.0.0.2", 8088, Endpoint.Source.MDNS);

    // Cache first: returns immediately, validator accepts.
    {
      List<DiscoveryCoordinator.Source> srcs = new ArrayList<>();
      srcs.add(new FakeSource(Endpoint.Source.CACHE, List.of(new Endpoint("10.0.0.2", 8088, Endpoint.Source.CACHE))));
      DiscoveryCoordinator c = new DiscoveryCoordinator(srcs, e -> true, 3);
      DiscoveryCoordinator.Result r = c.discover();
      check(r.found(), "cache hit found");
      eq(r.endpoint.source, Endpoint.Source.CACHE, "from cache");
    }

    // Cache present but stale (validation fails); mDNS then succeeds.
    {
      List<DiscoveryCoordinator.Source> srcs = new ArrayList<>();
      Endpoint stale = new Endpoint("10.0.0.99", 8088, Endpoint.Source.CACHE);
      srcs.add(new FakeSource(Endpoint.Source.CACHE, List.of(stale)));
      srcs.add(new FakeSource(Endpoint.Source.MDNS, List.of(hub)));
      DiscoveryCoordinator c = new DiscoveryCoordinator(srcs, e -> e.host.equals("10.0.0.2"), 3);
      DiscoveryCoordinator.Result r = c.discover();
      check(r.found(), "fell through to mDNS");
      eq(r.endpoint.source, Endpoint.Source.MDNS, "from mDNS");
    }

    // Lossy mDNS misses twice then hits on the third retry (multicast loss).
    {
      List<Endpoint> script = new ArrayList<>();
      script.add(null);
      script.add(null);
      script.add(hub);
      List<DiscoveryCoordinator.Source> srcs = new ArrayList<>();
      srcs.add(new FakeSource(Endpoint.Source.MDNS, script));
      DiscoveryCoordinator c = new DiscoveryCoordinator(srcs, e -> true, 3);
      DiscoveryCoordinator.Result r = c.discover();
      check(r.found(), "retried lossy source");
      eqi(r.attempts.size(), 3, "three attempts logged");
    }

    // Everything fails -> not found, falls past to (empty) -> manual needed.
    {
      List<DiscoveryCoordinator.Source> srcs = new ArrayList<>();
      srcs.add(new FakeSource(Endpoint.Source.MDNS, new ArrayList<>()));
      srcs.add(new FakeSource(Endpoint.Source.UDP_BROADCAST, new ArrayList<>()));
      DiscoveryCoordinator c = new DiscoveryCoordinator(srcs, e -> true, 2);
      DiscoveryCoordinator.Result r = c.discover();
      check(!r.found(), "nothing found");
      eqi(r.attempts.size(), 4, "2 mdns + 2 udp attempts"); // both lossy, retried twice
    }

    // Non-lossy source (manual) is tried once only.
    {
      List<Endpoint> script = new ArrayList<>();
      script.add(null);
      script.add(hub); // would succeed on 2nd, but manual is single-try
      List<DiscoveryCoordinator.Source> srcs = new ArrayList<>();
      srcs.add(new FakeSource(Endpoint.Source.MANUAL, script));
      DiscoveryCoordinator c = new DiscoveryCoordinator(srcs, e -> true, 3);
      DiscoveryCoordinator.Result r = c.discover();
      check(!r.found(), "manual tried once, gave null");
      eqi(r.attempts.size(), 1, "single manual attempt");
    }
  }
}
