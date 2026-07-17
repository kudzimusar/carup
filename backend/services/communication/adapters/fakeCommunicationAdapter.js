export class FakeCommunicationAdapter {
  constructor({ channel = 'in_app', provider = 'fake', failPlan = [] } = {}) {
    this.channel = channel;
    this.provider = provider;
    this.failPlan = [...failPlan];
    this.sent = [];
  }

  validateConfiguration() {
    return { available: true, provider: this.provider, channel: this.channel, mode: 'fake' };
  }

  async send(input) {
    const plan = this.failPlan.shift();
    if (plan) {
      return {
        accepted: false,
        retryable: plan.retryable !== false,
        errorCode: plan.errorCode || 'temporary_unavailable',
        errorMessage: plan.errorMessage || 'Deterministic fake adapter failure',
      };
    }
    const providerMessageId = `${this.provider}_${this.channel}_${input.messageId}`;
    this.sent.push({ ...input, providerMessageId });
    return {
      accepted: true,
      provider: this.provider,
      providerRequestId: `req_${input.notificationId}`,
      providerMessageId,
      providerStatus: 'delivered',
    };
  }
}

