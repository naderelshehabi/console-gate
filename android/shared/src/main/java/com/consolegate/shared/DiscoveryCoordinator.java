package com.consolegate.shared;

import java.util.ArrayList;
import java.util.List;

/**
 * Platform-independent Hub-discovery state machine. The Android layer plugs in
 * concrete {@link Source}s (mDNS via NsdManager, UDP broadcast, a cached last-known
 * endpoint, manual entry) and a {@link Validator} (a quick GET /hello). This class
 * encodes the *ordering, retry, and validation* policy so it can be unit-tested
 * without Android: try the fast cache first, then mDNS, then UDP broadcast (each
 * retried because Wi-Fi multicast is lossy), and finally fall back to manual IP.
 *
 * See docs/implement/07-android-app.md §7.3.
 */
public final class DiscoveryCoordinator {

  /** A way to obtain a candidate endpoint. Returns null if it found nothing. */
  public interface Source {
    Endpoint find();
    Endpoint.Source kind();
  }

  /** Confirms a candidate is really a reachable Hub (e.g. GET /hello). */
  public interface Validator {
    boolean isHub(Endpoint e);
  }

  public static final class Result {
    public final Endpoint endpoint;       // null if nothing worked
    public final List<String> attempts;   // human-readable trace
    Result(Endpoint endpoint, List<String> attempts) {
      this.endpoint = endpoint;
      this.attempts = attempts;
    }
    public boolean found() { return endpoint != null; }
  }

  private final List<Source> sources;
  private final Validator validator;
  private final int retriesPerLossySource;

  public DiscoveryCoordinator(List<Source> sources, Validator validator, int retriesPerLossySource) {
    this.sources = sources;
    this.validator = validator;
    this.retriesPerLossySource = Math.max(1, retriesPerLossySource);
  }

  private boolean lossy(Endpoint.Source k) {
    return k == Endpoint.Source.MDNS || k == Endpoint.Source.UDP_BROADCAST;
  }

  /** Run the discovery policy and return the first validated endpoint. */
  public Result discover() {
    List<String> attempts = new ArrayList<>();
    for (Source src : sources) {
      int tries = lossy(src.kind()) ? retriesPerLossySource : 1;
      for (int t = 0; t < tries; t++) {
        Endpoint cand = src.find();
        if (cand == null) {
          attempts.add(src.kind() + " try " + (t + 1) + ": no candidate");
          continue;
        }
        if (validator.isHub(cand)) {
          attempts.add(src.kind() + " try " + (t + 1) + ": validated " + cand.host + ":" + cand.port);
          return new Result(cand, attempts);
        }
        attempts.add(src.kind() + " try " + (t + 1) + ": candidate " + cand.host + " failed validation");
      }
    }
    return new Result(null, attempts);
  }
}
