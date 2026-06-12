/**
 * CarUp OS — In-Memory Telemetry and Operations Metrics Hub
 * 
 * Collects and stores transactional outbox metrics, OCR provider performance data,
 * webhook dispatch stats, trust-engine anomaly counters, and escrow lifecycle logs.
 */
class OperationsMetricsHub {
  constructor() {
    this.startTime = Date.now();
    this.outbox = {
      totalProcessed: 0,
      totalFailed: 0,
      backlogCount: 0,
      lastLagMs: 0,
      attemptsHistogram: {},
    };
    this.ocr = {
      totalRequests: 0,
      totalLatencyMs: 0,
      lowConfidenceCount: 0,
      poorQualityCount: 0,
      tamperingDetectedCount: 0,
      providerFailureCount: 0,
      providersActive: {
        gemini: false,
        groq: false,
        openrouter: false,
        moonshot: false,
      }
    };
    this.webhooks = {
      totalDispatched: 0,
      successCount: 0,
      failureCount: 0,
      averageDurationMs: 0,
      totalDurationMs: 0,
      failuresByUrl: {},
    };
    this.trustEngine = {
      recalculationsCount: 0,
      mismatchAlertsCount: 0,
      reputationDegradationCount: 0,
      quarantinedListingsCount: 0,
    };
    this.escrows = {
      totalReservations: 0,
      activeEscrowsByStage: {
        'Pending': 0,
        'Escrowed': 0,
        'Inspecting': 0,
        'Completed': 0,
        'Disputed': 0,
        'Refunded': 0,
      },
      completionsCount: 0,
      refundsCount: 0,
    };
    this.api = {
      totalRequests: 0,
      errorsCount: 0,
      totalLatencyMs: 0,
      endpointsLatency: {}, // path -> { count, averageMs }
    };
  }

  // Outbox Telemetry Helper
  recordOutboxBatch(backlogCount) {
    this.outbox.backlogCount = backlogCount;
  }

  recordOutboxSuccess(eventType, elapsedMs) {
    this.outbox.totalProcessed += 1;
    this.outbox.lastLagMs = elapsedMs;
  }

  recordOutboxFailure(eventType, attemptNumber) {
    this.outbox.totalFailed += 1;
    this.outbox.attemptsHistogram[attemptNumber] = (this.outbox.attemptsHistogram[attemptNumber] || 0) + 1;
  }

  // OCR Telemetry Helper
  recordOcrRequest(provider, success, latencyMs, confidence, isPoorQuality, isTampered) {
    this.ocr.totalRequests += 1;
    this.ocr.totalLatencyMs += latencyMs;
    
    // Update active providers mapping from env availability checks
    this.ocr.providersActive.gemini = !!process.env.GEMINI_API_KEY;
    this.ocr.providersActive.groq = !!process.env.CARUP_KIMI_GROQ_API_KEY;
    this.ocr.providersActive.openrouter = !!process.env.OPENROUTER_API_KEY;
    this.ocr.providersActive.moonshot = !!process.env.MOONSHOT_API_KEY;

    if (!success) {
      this.ocr.providerFailureCount += 1;
      return;
    }

    if (confidence < 0.80) {
      this.ocr.lowConfidenceCount += 1;
    }
    if (isPoorQuality) {
      this.ocr.poorQualityCount += 1;
    }
    if (isTampered) {
      this.ocr.tamperingDetectedCount += 1;
    }
  }

  // Webhook Telemetry Helper
  recordWebhookDispatch(url, durationMs, success) {
    this.webhooks.totalDispatched += 1;
    this.webhooks.totalDurationMs += durationMs;
    this.webhooks.averageDurationMs = Math.round(this.webhooks.totalDurationMs / this.webhooks.totalDispatched);

    if (success) {
      this.webhooks.successCount += 1;
    } else {
      this.webhooks.failureCount += 1;
      this.webhooks.failuresByUrl[url] = (this.webhooks.failuresByUrl[url] || 0) + 1;
    }
  }

  // Trust Engine Telemetry Helper
  recordTrustRecalculation() {
    this.trustEngine.recalculationsCount += 1;
  }

  recordTrustMismatch() {
    this.trustEngine.mismatchAlertsCount += 1;
  }

  recordReputationDegradation() {
    this.trustEngine.reputationDegradationCount += 1;
  }

  recordListingQuarantine() {
    this.trustEngine.quarantinedListingsCount += 1;
  }

  // Escrow Telemetry Helper
  recordEscrowReservation() {
    this.escrows.totalReservations += 1;
  }

  recordEscrowStateTransition(previousState, newState) {
    if (previousState && this.escrows.activeEscrowsByStage[previousState] > 0) {
      this.escrows.activeEscrowsByStage[previousState] -= 1;
    }
    this.escrows.activeEscrowsByStage[newState] = (this.escrows.activeEscrowsByStage[newState] || 0) + 1;

    if (newState === 'Completed') {
      this.escrows.completionsCount += 1;
    } else if (newState === 'Refunded') {
      this.escrows.refundsCount += 1;
    }
  }

  // API Latency Telemetry Helper
  recordApiTransaction(path, latencyMs, success) {
    this.api.totalRequests += 1;
    this.api.totalLatencyMs += latencyMs;
    if (!success) {
      this.api.errorsCount += 1;
    }

    if (!this.api.endpointsLatency[path]) {
      this.api.endpointsLatency[path] = { count: 0, averageMs: 0, totalMs: 0 };
    }
    
    const metric = this.api.endpointsLatency[path];
    metric.count += 1;
    metric.totalMs += latencyMs;
    metric.averageMs = Math.round(metric.totalMs / metric.count);
  }

  /**
   * Retrieves full aggregated structured telemetry data
   */
  getSnapshot() {
    const uptimeSec = Math.round((Date.now() - this.startTime) / 1000);
    return {
      uptimeSeconds: uptimeSec,
      systemMetrics: {
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
      },
      outbox: this.outbox,
      ocr: this.ocr,
      webhooks: this.webhooks,
      trustEngine: this.trustEngine,
      escrows: this.escrows,
      api: {
        totalRequests: this.api.totalRequests,
        errorsCount: this.api.errorsCount,
        averageLatencyMs: this.api.totalRequests > 0 ? Math.round(this.api.totalLatencyMs / this.api.totalRequests) : 0,
        endpointsLatency: this.api.endpointsLatency,
      }
    };
  }
}

export const metricsHub = new OperationsMetricsHub();
export default metricsHub;
