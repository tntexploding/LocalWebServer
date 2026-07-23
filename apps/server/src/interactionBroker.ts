import {randomUUID} from 'node:crypto';
import type {UserInteraction} from '@las/core';

interface PromptWaiter {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abort?: () => void;
}

/** Stores local notifications and resolves WebUI choice requests. */
export class InteractionBroker {
  private readonly interactions = new Map<string, UserInteraction>();
  private readonly promptWaiters = new Map<string, PromptWaiter>();

  list(): UserInteraction[] {
    return [...this.interactions.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  notify(title: string, message: string): UserInteraction {
    const interaction: UserInteraction = {
      id: randomUUID(),
      type: 'notification',
      title,
      message,
      options: [],
      createdAt: new Date().toISOString(),
    };
    this.interactions.set(interaction.id, interaction);
    return interaction;
  }

  prompt(input: {
    title: string;
    message: string;
    options: string[];
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<string> {
    input.signal?.throwIfAborted();
    const id = randomUUID();
    const createdAt = new Date();
    const interaction: UserInteraction = {
      id,
      type: 'prompt',
      title: input.title,
      message: input.message,
      options: input.options,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + input.timeoutMs).toISOString(),
    };
    this.interactions.set(id, interaction);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        const waiter = this.promptWaiters.get(id);
        if (waiter) clearTimeout(waiter.timer);
        if (waiter?.abort && input.signal)
          input.signal.removeEventListener('abort', waiter.abort);
        this.promptWaiters.delete(id);
        this.interactions.delete(id);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Prompt timed out after ${input.timeoutMs}ms.`));
      }, input.timeoutMs);
      const abort = input.signal
        ? () => {
            cleanup();
            reject(new Error('Prompt was cancelled.'));
          }
        : undefined;
      this.promptWaiters.set(id, {
        resolve: value => {
          cleanup();
          resolve(value);
        },
        reject: error => {
          cleanup();
          reject(error);
        },
        timer,
        abort,
      });
      if (abort) input.signal?.addEventListener('abort', abort, {once: true});
    });
  }

  respond(id: string, value: string): boolean {
    const interaction = this.interactions.get(id);
    const waiter = this.promptWaiters.get(id);
    if (!interaction || interaction.type !== 'prompt' || !waiter) return false;
    if (!interaction.options.includes(value)) {
      throw new Error(`Unknown prompt option: ${value}`);
    }
    waiter.resolve(value);
    return true;
  }

  dismiss(id: string): boolean {
    const interaction = this.interactions.get(id);
    if (!interaction) return false;
    const waiter = this.promptWaiters.get(id);
    if (waiter) waiter.reject(new Error('Prompt was dismissed.'));
    else this.interactions.delete(id);
    return true;
  }
}
