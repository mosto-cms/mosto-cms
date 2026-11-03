/**
 * The admin page must read its runtime data (cookies) INSIDE a Suspense
 * boundary it owns, so a site on Next.js 16 with `cacheComponents: true`
 * builds without wrapping it (and without `export const dynamic`).
 */
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { createAdminPage } from '../src/admin.js';
import { setup } from './fixtures.js';

describe('createAdminPage', () => {
  it('returns a synchronous page whose element is a Suspense boundary', async () => {
    const { site } = await setup();
    const Page = createAdminPage(site);
    // Synchronous: rendering the page itself must not touch cookies() or searchParams.
    const element = Page({ searchParams: Promise.resolve({}) }) as ReactElement<{ fallback: unknown; children: unknown }>;
    expect(element.type).toBe(Suspense);
    expect(element.props.fallback).toBeTruthy();
    const inner = element.props.children as ReactElement;
    expect(typeof (inner.type as { name?: string })).toBe('function');
  });
});
