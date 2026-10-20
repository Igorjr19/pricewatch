import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Dep {
  value() {
    return 42;
  }
}

@Injectable()
class Consumer {
  constructor(private readonly dep: Dep) {}
  get() {
    return this.dep.value();
  }
}

describe('REQ-DX-003 Vitest + SWC decorator metadata', () => {
  it('injects a provider through the constructor', async () => {
    const mod = await Test.createTestingModule({
      providers: [Dep, Consumer],
    }).compile();
    expect(mod.get(Consumer).get()).toBe(42);
  });
});
