# Diagrams

Four figures, one claim each. Mermaid, rendered by GitHub.

## Figure 1 — The component map

Every component depends on identity-service and nothing else at runtime. Everything else is a port with a local default, or a reference by id.

```mermaid
flowchart LR
    subgraph built
        ID[identity-service]
        SP[specs-service]
    end
    subgraph next
        WK[work-service]
        RT[runtime-service]
        AG[agent-service]
    end
    SPINE[(the spine<br/>S3 archive · SNS/SQS)]

    SP -- authn, principals --> ID
    WK -- authn, principals --> ID
    RT -- authn, principals --> ID
    AG -- authn, principals --> ID

    SP -. events .-> SPINE
    WK -. events .-> SPINE
    RT -. events .-> SPINE
    AG -. events .-> SPINE
    SPINE -. fan-out .-> WK
    SPINE -. fan-out .-> RT

    WK -- "closes on version (id)" --- SP
    WK -- "about instance (id)" --- RT
    AG -- "discharges item (id)" --- WK
    RT -- "realises version (id)" --- SP
```

Solid: a required call. Dotted: an event on the spine. Plain: a reference by id, no call.

## Figure 2 — Human-gated ops, use case 1

A person appears three times: to validate the analysis, to merge the fix, and — only when authority is short — to take the act the agent was refused.

```mermaid
sequenceDiagram
    autonumber
    participant App as application (own account)
    participant WK as work-service
    participant AG as agent-service + runner
    participant SP as specs-service
    participant GH as GitHub
    participant RT as runtime-service
    participant H as a person

    App->>WK: signal (SNS ops-signals)
    WK->>WK: severity from policy → remediation item, clocks
    WK-->>H: Slack: SEV2 · item link
    AG->>WK: claim (authority checked)
    AG->>SP: propose cause_analysis
    SP-->>H: decision page
    H->>SP: accept
    AG->>GH: draft PR (fix run)
    GH-->>H: review
    H->>GH: merge
    GH->>RT: deploy event (EventBridge)
    App->>WK: signal state ok
    WK->>WK: evidence plan satisfied → closed done
```

## Figure 3 — The spine

The archive is the record; the queue is transport; every database is a projection.

```mermaid
flowchart LR
    C1[component<br/>transactional outbox] -->|drain, scheduled| R[relay]
    R -->|seal daily segments<br/>Merkle chain in code| S3[(S3 archive<br/>system of record)]
    R -->|publish| SNS[SNS FIFO]
    SNS --> Q1[SQS FIFO<br/>work-service]
    SNS --> Q2[SQS FIFO<br/>runtime-service]
    S3 -->|rebuild from zero| P[(component database<br/>= projection)]
    S3 -->|export + verify| X[the export<br/>readable with services off]
```

## Figure 4 — The signals split

Detection where the knowledge is; response where the record is.

```mermaid
flowchart LR
    subgraph tenant application account
        AL[CloudWatch alarms<br/>thresholds, DLQ, errors] --> T[SNS ops-signals]
        MON[app's own monitor<br/>P-hint] --> T
        PIPE[pipeline] --> EB[EventBridge<br/>deploy, findings]
        T -.-> OTHER[other subscribers<br/>Chatbot, email]
    end
    subgraph maestro deployment
        T -->|cross-account| Q[SQS intake]
        EB -->|cross-account| Q
        Q --> N[normalise · dedup · correlate]
        N --> POL[severity from policy<br/>clocks · ceilings]
        POL --> ITEM[work item]
        ITEM --> NOTIFY[Slack / SES with item link]
        HB[heartbeat clock<br/>silence] --> N
        ADV[GitHub advisories] --> N
    end
```
