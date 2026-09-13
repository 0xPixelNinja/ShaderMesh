# PRODUCT.md — ShaderMesh Dashboard

register: product

## What it is

The web interface for ShaderMesh, a decentralized marketplace for renting
compute. The headline use case is AI and LLM compute: rent a GPU to run or
fine-tune a model, or call a managed, provider-served, OpenAI-compatible
inference endpoint. It generalizes to any compute, and it keeps a verifiable-task
mode for deterministic jobs such as rendering and batch. The dashboard is where
requesters rent and run compute, providers list and manage their nodes, and
anyone inspects the on-chain state.

## Users and jobs to be done

- Requester (rental): browse GPU listings, lease a node, get an endpoint,
  monitor uptime, watch escrow stream, extend or end the lease, track spend.
- Requester (inference): pick a model, call the endpoint or use a playground,
  monitor usage and cost, manage prepaid credits.
- Requester (task): submit a deterministic job, watch it verify, download the
  result.
- Provider: register and stake, advertise hardware, pass benchmark and
  attestation challenges, serve leases and inference, send uptime heartbeats,
  monitor earnings and reputation, respond to disputes.
- Reviewer or observer: explore leases, jobs, disputes, and slashing events.

## Surfaces

1. Dashboard: network at a glance, my rentals and jobs, live activity.
2. Rent GPUs: marketplace of provider listings (GPU, VRAM, price/hour,
   reputation, uptime); lease flow; My rentals with live uptime and streamed spend.
3. Models: catalog of served models with a prompt playground, usage, and cost.
4. Jobs: verifiable-task list and Job detail (live tile assembly for rendering).
5. Providers: registry with stake, reputation, capabilities, uptime.
6. Explorer: leases, jobs, tasks, disputes, and slashing events.
7. Provider console: stake, listings, heartbeats, earnings, availability.

## Principles

- Earned familiarity. It should feel like a precise professional tool (Linear,
  Stripe, Raycast), not a novelty. The tool disappears into the task.
- Data first. Dense where it helps, calm where it counts. Real-time truth.
- Trust is visible. Status, verification, and slashing are always legible.

## Constraints (binding)

- Look: clean, modern, sharp, professional. Not brutalist.
- Accent: amber only, used for primary actions, current selection, and state.
  Light `#D97706`, dark `#F59E0B`.
- Prohibited: neon colors, violet or purple, glassmorphism as default, large
  glows, decorative multi color gradients, pill-shaped buttons, emoji in UI.
- Writing: plain professional English. No em dashes. No hype.
- Accessibility: WCAG AA contrast, visible focus states, keyboard support.

## Stack (planned)

Next.js (App Router) + TypeScript + wagmi/viem + Tailwind. Reads from the chain
and the orchestrator API. All writes go through the user wallet.
