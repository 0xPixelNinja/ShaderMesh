"""Chapters 1 to 5 of the ShaderMesh final report."""


def chapter1(R, F):
    R.chapter_h1("INTRODUCTION")
    R.h2("Background")
    R.p("Demand for graphics processing unit (GPU) compute has grown quickly with the spread of machine learning and large language models (LLMs). Training, fine-tuning, and serving a model all need accelerators, and most of the capacity that can be rented on demand sits with a small number of cloud operators. At the same time, many capable GPUs in workstations, studios, and laboratories are idle for most of the day. The two facts point to a market that is hard to organize: owners of spare capacity have no simple way to rent it to strangers, and renters have no simple way to trust capacity they cannot inspect.")
    R.p("A conventional marketplace solves this with a trusted operator. The operator verifies listings, holds payment, meters usage, and settles disputes. That arrangement works, but it concentrates power. The operator can change prices, suspend accounts, and decide dispute outcomes, and the billing and reliability history of every participant lives in a database that only the operator controls. Public blockchains offer a different foundation: a shared ledger that holds funds under rules that no single party can rewrite [@nakamoto, @buterin].")
    R.p("**ShaderMesh** is a decentralized marketplace for renting GPU and CPU compute on Ethereum. Providers stake a utility token and rent out capacity. Requesters lease that capacity to run containerized workloads, or buy managed, OpenAI-compatible LLM inference from a provider [@openai]. The blockchain is the trust, coordination, and payment layer. It is never the compute layer: workloads, model inference, indexing, and file storage all run off chain.")
    R.h2("Problem Statement")
    R.p("Renting compute from a stranger raises four problems that a marketplace must address.")
    R.numbered([
        "**Payment under mutual distrust.** The renter does not want to pay before service is delivered. The provider does not want to deliver before payment is secured.",
        "**Proof of service.** A rented machine runs a workload that cannot be re-executed and compared. An LLM response or a training run has no single correct answer to check, so the market needs evidence that the service was available, not proof that the result was right.",
        "**Proof of capability.** A provider can advertise a GPU it does not have. The market needs a way to test advertised hardware repeatedly and to penalize false claims.",
        "**Neutral enforcement.** Penalties for missed service, such as refunds and loss of collateral, must execute automatically under public rules, without an operator who can favor one side.",
    ])
    R.p("A second class of work has the opposite property. Deterministic jobs, such as rendering a tile of an image or running a fixed batch computation, produce an output that another machine can recompute and compare. For these jobs the market can use verification by re-execution. A single design that treats both classes the same way would either over-verify rentals, which is impossible, or under-verify deterministic jobs, which is wasteful.")
    R.h2("Why Blockchain")
    R.p("A blockchain is justified here only where participants who do not trust each other need shared, tamper-resistant state and automatic enforcement. ShaderMesh uses Ethereum for exactly these functions.")
    R.bullets([
        "**Escrow with streamed settlement.** A contract holds the renter funds and releases them per completed interval, then refunds the rest.",
        "**Staking and slashing.** Providers lock collateral that the contracts can confiscate for provable failures, with no operator discretion.",
        "**On-chain reputation.** Outcomes are recorded in a public score that no marketplace database controls.",
        "**Token payments.** A single ERC-20 token [@eip20] settles payments and collateral without banks or chargebacks.",
        "**Auditable rules.** Pricing, leasing, attestation, and penalty logic are open code that any participant can read and verify.",
    ])
    R.p("Ethereum cannot observe a GPU, judge an LLM answer, or run a heavy workload at acceptable cost. The project therefore keeps the chain small. It stores money, collateral, lifecycle state, commitments, and content identifiers, and leaves everything heavy to untrusted off-chain components that cannot move funds or force a result. The base-layer security is inherited from Ethereum proof of stake [@pos]. The project contributes application-layer mechanism design on top of it.")
    R.h2("Scope of the Project")
    R.p("The delivered system is a working research and testnet prototype. It covers the following.")
    R.bullets([
        "Six Solidity contracts (SmeshToken, ProviderRegistry, RentalMarket, InferenceMarket, JobMarket, and Verification) with 42 automated tests.",
        "A provider agent in Python that serves leases, serves inference, executes deterministic tasks in constrained Docker containers, sends heartbeats, and answers benchmark challenges.",
        "An attester service that records hardware attestations and issues, judges, and expires benchmark challenges.",
        "An orchestrator in TypeScript that indexes chain events into a rebuildable Postgres projection, serves a read API and an inference gateway, and splits and stitches deterministic jobs through IPFS.",
        "A Next.js web application with a landing page, a dashboard, rental, model, provider, and explorer pages, in light and dark themes.",
        "A Monte Carlo simulator of the verification game and of rental economics.",
        "A local deployment with Docker Compose and a public deployment on the Sepolia test network [@sepolia] with source-verified contracts.",
    ])
    R.p("The following items are outside the scope of this project. They are stated here so the results in later chapters are read correctly.")
    R.bullets([
        "A new base-layer blockchain or consensus algorithm.",
        "On-chain verification of LLM output correctness, or on-chain training.",
        "Production custody, identity verification, or fiat payment rails.",
        "A token sale or any real financial instrument. SMESH is a utility token that has value only on test networks.",
        "Blender rendering with perceptual verification, which was descoped to future work in the final phase plan.",
    ])
    R.h2("Organization of the Report")
    R.p("Chapter 2 states the objectives and motivation. Chapter 3 surveys related work and compares it with ShaderMesh, and Chapter 4 describes existing systems and the gap that remains. Chapter 5 summarizes the requirements and their implementation status. Chapter 6 presents the system design, and Chapter 7 describes each smart contract and the benchmark challenge mechanism in detail. Chapter 8 covers the implementation of the off-chain components and the deployment. Chapter 9 describes testing. Chapter 10 reports the evaluation results, including gas costs, simulation results, and the live Sepolia deployment. Chapter 11 states limitations, risks, and ethical considerations, and Chapter 12 concludes with future work. The appendices list deployment addresses, the application programming interface (API), and the test commands.")


def chapter2(R, F):
    R.chapter_h1("OBJECTIVES AND MOTIVATION")
    R.h2("Objectives")
    R.p("The project had five objectives, fixed at the Review 1 stage [@review1]. Each is listed below with the outcome measured at the end of the project.")
    R.numbered([
        "**Design a decentralized compute-rental marketplace on Ethereum** with on-chain listings, leases, streamed escrow, provider staking, and settlement by smart contract. Outcome: the RentalMarket, InferenceMarket, and ProviderRegistry contracts implement these functions, and a lease was run end to end on Sepolia.",
        "**Secure rented compute without result verification** using stake, signed uptime heartbeats, hardware attestation and benchmark challenges, reputation, and slashing for service-level breaches. Outcome: implemented and tested. Benchmark challenges run live on Sepolia.",
        "**Specialize in LLM and AI compute** through a managed OpenAI-compatible inference endpoint and raw GPU leases, while allowing any containerized workload. Outcome: prepaid inference for `qwen3:0.6b` and a GPU container lease were validated on an RTX 4070 Laptop GPU provider.",
        "**Retain a verifiable-task mode** for deterministic jobs, using an optimistic re-execution game on the same staking and reputation layer. Outcome: implemented with exact-hash comparison. Commit-reveal, randomized selection, and perceptual comparison remain future work.",
        "**Deliver a live prototype and evaluate it.** Outcome: a Docker Compose stack, a Sepolia deployment, a simulator, a gas report, and a test suite of 42, 58, 54, 15, and 24 checks across five components (Chapter 9).",
    ])
    R.h2("Motivation")
    R.h3("Economic")
    R.p("Independent owners may have idle capacity, while requesters face limited or expensive supply. A marketplace can coordinate that supply without a custodial billing operator. Existing GPU marketplaces widen supply but still rely on platform servers for identity checks, listing verification, billing, and disputes [@vast].")
    R.h3("Technical")
    R.p("Verifiable outsourced computation is an active research area. Interactive verification games [@truebit], optimistic execution with challenge windows [@arbitrum], and probabilistic spot checking [@livepeer] each address part of the problem for specific workloads. A practical marketplace must combine them with availability-based controls for work that cannot be re-executed. Building one forces explicit decisions about what the chain can know and what it cannot.")
    R.h3("Educational")
    R.p("The project exercises the main topics of a blockchain course in one coherent system: ERC-20 tokens, escrow, access control, staking and slashing, on-chain state machines, event-driven off-chain services, reputation, dispute resolution, and mechanism design with adversarial participants.")
    R.h3("Practical")
    R.p("Rental, inference, and deterministic task flows all produce observable outputs, which makes evaluation concrete. A lease produces heartbeat and settlement events. An inference call produces token counts and a payment. A deterministic job produces an image that the orchestrator stitches and pins.")
    R.h2("Design Principles")
    R.p("Four principles guided decisions throughout the project and recur in later chapters.")
    R.bullets([
        "**The chain is the referee, not the worker.** Value movement and result validation live only in contracts.",
        "**Off-chain components are untrusted.** If an agent, gateway, or web page could steal funds or force a fake result, that is a defect.",
        "**State what is not proven.** A heartbeat shows that a key was live. A benchmark shows responsiveness and throughput. Neither proves the exact GPU model or the quality of an LLM answer. The report and the user interface say so.",
        "**Separate trust models for separate workloads.** Rentals use availability evidence. Deterministic jobs use re-execution. Both share one staking and reputation layer.",
    ])


def chapter3(R, F):
    R.chapter_h1("LITERATURE SURVEY")
    R.p("The survey uses primary papers where they exist and official project documentation for systems whose operation has changed since their original publication. All online sources were accessed in October 2026. It extends the Review 1 survey [@review1] and groups prior work by the problem it addresses.")
    R.h2("Programmable Settlement")
    R.p("Bitcoin showed that strangers can transfer value without a trusted intermediary [@nakamoto]. Ethereum added a general-purpose virtual machine, so that escrow, tokens, and staking can be written as contracts [@buterin, @wood]. On-chain computation is expensive, so every compute marketplace built on Ethereum must execute work elsewhere and bring back only commitments and payments. The ERC-20 standard [@eip20] and the audited OpenZeppelin library [@oz] supply the token and access-control primitives that ShaderMesh composes.")
    R.h2("Decentralized Compute Marketplaces")
    R.p("**Golem** was an early Ethereum compute market and began with Blender rendering. Its documentation describes a peer-to-peer market of requestors and providers [@golem]. Result trust relies largely on redundancy and reputation rather than a precise on-chain referee.")
    R.p("**Akash** matches container deployments to providers through a reverse auction on a Cosmos-based chain [@akash]. It concentrates on availability and deployment, and does not verify the correctness of results.")
    R.p("**Render Network** focuses on GPU rendering for 3D content [@render]. It is specialized to rendering and depends on reputation and review for quality.")
    R.p("**iExec** builds a Proof-of-Contribution protocol and relies on trusted execution environments to attest computation [@iexec]. This gives stronger confidentiality guarantees but ties the design to specialized processor hardware.")
    R.p("**Vast.ai** is a centralized marketplace for rentable GPUs. The platform operator performs listing, billing, and dispute functions [@vast]. It is the closest commercial analogue of the supply side that ShaderMesh decentralizes.")
    R.h2("Verification of Off-Chain Computation")
    R.p("**TrueBit** introduced an interactive verification game in which a challenger disputes a result and an on-chain referee resolves the dispute by bisection [@truebit]. It is general, but the multi-round dispute logic is costly to implement and to run.")
    R.p("**Arbitrum** popularized optimistic execution: assume honesty, open a challenge window, and resolve on chain only if contested [@arbitrum]. ShaderMesh borrows the optimistic pattern and the challenge window for deterministic tasks.")
    R.p("**Livepeer** verifies video transcoding by probabilistic spot checks backed by stake [@livepeer]. The idea that a fraction of work is re-executed, with penalties large enough to deter cheating, is the basis of the ShaderMesh task market and of its break-even analysis in Chapter 6.")
    R.p("**Filecoin** uses proofs of replication and spacetime to make stored data verifiable [@filecoin]. It solves verifiable storage rather than computation, and serves as a design analogue for recurring, seeded challenges against a provider.")
    R.p("**Bittensor** scores machine learning contributions by peer ranking [@bittensor]. The verification is subjective and specific to learning tasks, which makes it unsuitable as a source of deterministic penalties.")
    R.h2("LLM Serving")
    R.p("Efficient LLM serving is an engineering field in its own right. Paged attention and similar techniques raise throughput on a given GPU [@vllm]. ShaderMesh does not compete here. It treats the serving runtime as a replaceable backend behind an OpenAI-compatible interface [@openai], with an Ollama backend [@ollama] used for the live validation.")
    R.h2("Comparison with ShaderMesh")
    R.p("{t:lit} compares the surveyed systems with ShaderMesh on workload, settlement, and verification approach. The comparison is limited to what each project documents. It does not rank the systems.")
    R.table("lit", "Comparison of related systems with ShaderMesh",
            ["System", "Workload", "Settlement and trust", "Verification approach", "Gap addressed by ShaderMesh"],
            [
                ["Golem [@golem]", "General compute, rendering", "Ethereum token, peer-to-peer market", "Redundancy and reputation", "No separate availability model and no on-chain SLA penalty."],
                ["iExec [@iexec]", "Off-chain compute with confidentiality", "Token and Proof-of-Contribution", "Trusted execution environments", "Depends on specialized hardware, not commodity GPUs."],
                ["Akash [@akash]", "Container deployments", "Reverse auction on a Cosmos chain", "Availability and deployment focus", "No verification of result correctness or hardware claims."],
                ["Render [@render]", "GPU 3D rendering", "Token payment to node operators", "Reputation and review", "Rendering only."],
                ["Livepeer [@livepeer]", "Video transcoding", "Stake and probabilistic payment", "Probabilistic spot checks", "Domain specific. ShaderMesh generalizes the spot-check idea."],
                ["Bittensor [@bittensor]", "Machine learning contributions", "Token rewards", "Peer scoring", "Subjective scoring, no deterministic penalties."],
                ["TrueBit [@truebit]", "Verifiable off-chain computation", "On-chain referee", "Interactive verification game", "Multi-round disputes are costly. Not aimed at rentals."],
                ["**ShaderMesh**", "GPU and CPU rental, LLM inference, deterministic tasks", "Streamed escrow, stake, bonds, reputation", "Heartbeats and benchmark challenges for rentals. Optimistic re-execution for deterministic tasks.", "Two explicit trust models over one staking layer. Limits are stated."],
            ],
            [2.7, 2.5, 2.9, 3.1, 3.3], size=9.5)
    R.h2("Synthesis")
    R.p("Prior work establishes the feasibility of programmable settlement, decentralized resource markets, probabilistic verification, hardware attestation, and optimized inference. The contribution of ShaderMesh is their integration under two explicit trust models. Non-replayable rentals use streamed escrow and availability-oriented controls. Deterministic jobs use optimistic verification. Both use a common staking and reputation layer.")
    R.p("The design does not remove all trust. Heartbeats show that a provider key was live, not that the service was good. Hardware attestation depends on the attester. Sampled checking depends on independent challengers and a suitable comparison rule. These limits are stated in Chapter 11 and are not hidden behind a general claim of verifiable AI.")


def chapter4(R, F):
    R.chapter_h1("EXISTING SYSTEM AND IDENTIFIED GAP")
    R.h2("Current Methods")
    R.p("The dominant method is centralized cloud rental. A customer selects an instance from a cloud provider or a GPU marketplace, accepts the operator account and billing rules, and reaches the machine through an API, SSH, a notebook, or a managed service. Community GPU marketplaces widen supply [@vast], but platform servers still perform identity checks, listing verification, billing, and dispute handling.")
    R.p("Decentralized compute systems take different approaches. Some match container deployments through a blockchain market [@akash]. Some specialize in rendering or video [@render, @livepeer]. Others verify deterministic execution through replication, challenge games, or trusted hardware [@truebit, @iexec]. Each demonstrates useful components, but they make different trade-offs between generality, cost, and trust.")
    R.h2("Problems and Limitations")
    R.bullets([
        "A centralized operator can change prices, suspend accounts, or control dispute outcomes.",
        "Billing and reliability histories may sit in a private database that participants cannot audit.",
        "Replicating every workload is expensive and does not suit interactive services such as inference endpoints.",
        "Hardware attestation can introduce a separate trusted authority or require specialized processors.",
        "Exact output comparison fails for many GPU and LLM workloads, where outputs differ across hardware or are subjective.",
        "Public provider machines create security risks for renter data and for the provider host.",
        "A blockchain cannot observe off-chain availability without signed reports, probes, or a trusted measurement service.",
    ])
    R.h2("Identified Gap")
    R.p("The gap is a transparent compute-rental agreement that supports streamed escrow and service-level penalties, while keeping a distinct verification path for workloads that are actually checkable. Funds and deterministic rules must stay on chain, compute must stay off chain, and the design must not claim that one verification mechanism applies to every workload.")
    R.p("{f:context} places ShaderMesh between its two market participants and the external systems it depends on. Each arrow in the figure states the relationship and the protocol it uses.")
    R.figure("context", F / "system-context.png", "System context: actors, ShaderMesh, and the external systems it depends on", max_h=10.5)
    R.h2("Proposed Approach")
    R.p("ShaderMesh addresses the gap in four steps. First, it escrows renter funds in a contract and releases them one interval at a time against provider heartbeats. Second, it requires providers to stake and bonds part of that stake for the duration of a lease, so that missed service has a price. Third, it gates market entry on an attestation and keeps testing attested providers with seeded benchmark challenges. Fourth, it keeps a separate optimistic re-execution market for deterministic jobs, so that verification is applied only where it is possible.")
    R.p("The approach leaves some trust in place. The attester judges benchmark answers, the requester reports inference usage, and heartbeat evidence comes from the provider itself. Chapter 11 returns to each of these limits.")


def chapter5(R, F):
    R.chapter_h1("REQUIREMENTS")
    R.p("The authoritative requirements are in the project specification [@srs]. This chapter summarizes them and reports the implementation status that was measured against the repository, not against roadmap intent.")
    R.h2("Actors")
    R.p("The specification names seven actors. The **requester** rents compute, buys inference, or posts a deterministic job. The **provider** owns capacity, stakes, and serves leases and models. A **challenger** is a provider that re-executes tasks to verify them. The **attester** is a trusted service that records hardware attestations and judges benchmark challenges. The **operator** runs a local or testnet deployment. A **reviewer** evaluates the project. Off-chain components act on behalf of these actors but hold no funds.")
    R.h2("Functional Requirements")
    R.p("There are 75 functional requirements in ten modules, with identifiers such as FR-RENT-04. Each is marked must or should. {t:frgroups} lists the modules, the requirement counts, and the main behavior each module must provide.")
    R.table("frgroups", "Functional requirement groups",
            ["Module", "IDs", "Count", "Main behavior required"],
            [
                ["Token", "FR-TKN", "3", "ERC-20 payment token, owner mint, rate-limited faucet."],
                ["Provider registry", "FR-REG", "10", "Register, stake and unstake free stake, reputation EMA, restricted bond and slash, eligibility, attestation, benchmark challenges."],
                ["Job market", "FR-JOB", "9", "Post jobs with escrow, claim with bond, submit commitments, optimistic settlement, timeout reclaim."],
                ["Verification", "FR-VER", "8", "Challenge, dispute, vote, majority resolution, duplicate-vote prevention. Commit-reveal and perceptual policy are should-level."],
                ["Orchestrator", "FR-ORC", "6", "Event index in Postgres, split, stitch, read API, live channel, no custody."],
                ["Provider agent", "FR-AGT", "10", "Auto register and stake, claim and execute tasks, sandboxing, challenger mode, serve leases and inference, answer challenges."],
                ["Web", "FR-WEB", "8", "Wallet connect, rent, models and playground, provider console, explorer, wallet-only writes."],
                ["Simulator", "FR-SIM", "4", "Break-even spot-check rate, trade-off analysis, mixed populations, rental economics."],
                ["Rental market", "FR-RENT", "10", "Listings, manifest-bound requests, bond on acceptance, streamed escrow, strict heartbeats, termination and slashing, extension."],
                ["LLM inference", "FR-LLM", "7", "Model offers, OpenAI-compatible server, gateway, cumulative usage settlement, signed request authorization."],
            ],
            [2.6, 1.8, 1.2, 8.9], align_right=())
    R.h3("Rental market")
    R.p("The rental module is the primary market. A provider lists capacity with a price per interval, an interval length, and minimum and maximum durations (FR-RENT-01). A requester opens a lease by escrowing the full price for the requested duration and binding a content-addressed workload manifest to a pending request (FR-RENT-02, FR-RENT-10). The lease clock and the provider bond start only when the provider accepts. During the lease, a provider heartbeat must back every settled interval (FR-RENT-05). Anyone can terminate a lease after a missed heartbeat plus a grace period, which slashes the bond and refunds the unused escrow (FR-RENT-06).")
    R.h3("Inference")
    R.p("A provider advertises a model and a price per token (FR-LLM-01). A requester opens a prepaid credit, signs each request with a short-lived EIP-191 signature [@eip191], and submits monotonic cumulative usage to settle against the credit (FR-LLM-04, FR-LLM-07). The gateway routes only to the provider fixed by the credit.")
    R.h3("Verifiable tasks")
    R.p("A requester posts a job with an input content identifier (CID), a task count, and a reward per task, and the full reward is escrowed (FR-JOB-01, FR-JOB-02). A provider claims a task with a bond, submits a hash commitment and an output CID, and is paid after a challenge window unless a dispute is upheld (FR-JOB-03 to FR-JOB-05). Any eligible provider other than the task owner may challenge by submitting an independently computed hash (FR-VER-01).")
    R.h3("Provider operations and attestation")
    R.p("A provider registers, stakes, and obtains a fresh attestation before it can list capacity or offer a model. The registry accepts benchmark challenges against attested providers. A failed or missed challenge slashes free stake and lowers reputation (FR-REG-09, FR-AGT-10).")
    R.h2("Non-Functional Requirements")
    R.p("Twelve non-functional requirements constrain security, performance, reliability, usability, portability, maintainability, and cost. They are listed in {t:nfr}.")
    R.table("nfr", "Non-functional requirements",
            ["ID", "Requirement"],
            [
                ["NFR-SEC-01", "Off-chain components must not custody funds or force result acceptance."],
                ["NFR-SEC-02", "Contracts follow checks-effects-interactions and guard token movements against reentrancy."],
                ["NFR-SEC-03", "No secrets in the repository. Only example environment files with test values."],
                ["NFR-SEC-04", "Provider job execution is sandboxed with CPU, memory, and network limits."],
                ["NFR-PERF-01", "Core on-chain operations stay within a modest gas budget suitable for a testnet demonstration."],
                ["NFR-PERF-02", "The dashboard reflects a new on-chain event within a few seconds."],
                ["NFR-REL-01", "The local stack starts reliably with one command and correct boot ordering."],
                ["NFR-REL-02", "The orchestrator index is reconstructable from chain history after data loss."],
                ["NFR-USE-01", "The dashboard meets WCAG AA contrast and shows visible focus states [@wcag]."],
                ["NFR-PORT-01", "The system runs on Windows, macOS, and Linux through Docker."],
                ["NFR-MAINT-01", "Code passes linting and type checks. Contract logic is covered by tests."],
                ["NFR-COST-01", "The demonstration runs at zero cost on a local devnet and at low cost on a testnet."],
            ],
            [2.8, 11.7])
    R.h2("Traceability and Status")
    R.p("Status was assessed from behavior in the repository. Of the 75 functional requirements, 64 are done, 6 are partial, and 5 are planned. {t:trace} groups requirements and gives the evidence or the gap. Planned items are all should-level.")
    R.table("trace", "Requirements traceability and implementation status",
            ["Requirement", "Status", "Evidence or gap"],
            [
                ["FR-TKN-01 to 03", "Done", "SmeshToken: ERC-20, owner mint, rate-limited faucet."],
                ["FR-REG-01 to 07, 09, 10", "Done", "ProviderRegistry and contract tests: registration, stake, bond, eligibility, availability, EMA outcomes, benchmark challenges."],
                ["FR-REG-08", "Partial", "Free-form capability JSON and attested GPU model and VRAM exist. CPU and region are not typed registry fields."],
                ["FR-JOB-01 to 09", "Done", "JobMarket, agent integration tests, orchestrator projection."],
                ["FR-VER-01 to 05", "Done", "Verification: eligible non-self voting, disputes, quorum, majority resolution, duplicate-vote prevention."],
                ["FR-VER-06 to 08", "Planned", "Commit-reveal, reputation-weighted random selection, and perceptual verification are not implemented."],
                ["FR-ORC-01 to 06", "Done", "Deployment discovery, Postgres projection and replay, split, stitch, API, SSE, no custody."],
                ["FR-AGT-01 to 07, 09, 10", "Done", "Worker, challenger, IPFS, sandbox, retries, inference endpoint, benchmark responder."],
                ["FR-AGT-08", "Partial", "Serves accepted leases with strict heartbeats, but runs provider-configured workloads, not requester-defined containers."],
                ["FR-WEB-01 to 03, 05 to 08", "Done", "Wallet, rental, prepaid inference, provider console, explorer, copy-safe values, wallet-only writes."],
                ["FR-WEB-04", "Planned", "Requester job posting and live tile assembly are not implemented. The explorer shows jobs and tasks."],
                ["FR-SIM-01 to 04", "Done", "Simulator covers verification and rental economics with 15 tests."],
                ["FR-RENT-01 to 07, 09, 10", "Done", "RentalMarket with agent and web clients."],
                ["FR-RENT-08", "Partial", "Lease success or failure updates the EMA. No proportional uptime score or lease dispute mechanism."],
                ["FR-LLM-02, 04, 07", "Done", "Provider endpoint, signed authorization, cumulative settlement, refunds."],
                ["FR-LLM-01, 03, 06", "Partial", "Context length is not an offer field. The gateway does not probe health or fail over. Lease workloads are provider-configured."],
                ["FR-LLM-05", "Planned", "No sampled inference reputation mechanism."],
                ["NFR-SEC-01 to 04", "Done (prototype)", "Custody boundaries, OpenZeppelin guards, secret templates, gateway controls, constrained workers. Docker socket authority remains a host risk."],
                ["NFR-REL-01, 02", "Done", "Compose health ordering. Snapshot plus ordered replay."],
                ["NFR-MAINT-01", "Done", "CI runs compile, tests, lint, type checks, build, gas, smoke, and browser checks. No property-based fuzzing."],
                ["NFR-PERF-01, 02, USE-01, PORT-01, COST-01", "Partial", "Gas report and responsive browser checks exist. Formal accessibility, latency, cross-platform, and public cost acceptance are not complete."],
            ],
            [3.6, 1.9, 9.0], size=9.5)
    R.p("Section 12 of the specification gives the same table in full. The partial and planned items are carried into the limitations in Chapter 11 and the future work in Chapter 12.")
