# Work division: technical report, slides and 30-minute video (Project part)

Audience: the four team members. Scope: the **Project** part of the course requirements only (the Presentation part is excluded).
Sources: the course requirements PDF (`Reports/*.pdf`), `REQUIREMENTS.md`, `AGENTS.md`, `WEBAPP.md`, the report repo `Reports/ProjectReport/`, and the current state of the code.

Everything here is a proposal. Hours and dates are meant to be edited by the team.

---

## 1. Current state (what already exists)

| Area | State |
|---|---|
| Report skeleton | Cover and member list done. Commitment and abstract are placeholders. Chapters 1, 3, 4, 5 and 6 are headings with `% TODO` comments and a few `\dien{...}` fill-ins. |
| Report chapter 2 | **Largely written** (micro-batch concept, mechanism, Kafka, Spark Structured Streaming, checkpoint, comparison of three processing models, about 200 lines). It covers the streaming half only. |
| Report references | `refs.bib` has 4 entries. |
| System | All 8 BRs have a page or an endpoint. Cassandra, Kafka, Spark, Trino, dbt, FastAPI and the web app run in Docker Compose. |
| Benchmarks | **Not implemented.** The 5 `just bench-*` recipes only print "NOT IMPLEMENTED"; there is no `benchmarks/` folder. |

---

## 2. Roles

Each member owns **2 business requirements end to end**: the system part, the report subsections, the benchmark or test evidence, and the demo segment. The person who built something is also the one who explains it.

| Member | BRs | Technology area to explain |
|---|---|---|
| **Đạt** (M1) | BR1, BR7 | FastAPI access layer, Next.js web app, response times and usability of the application |
| **Nhân** (M2) | BR2, BR3 | Kafka, Spark Structured Streaming (existing chapter 2), Cassandra data modelling, simulator and ingest |
| **Tịnh** (M3) | BR4, BR8 | dbt models and tests, data quality and lineage, alert rules and lifecycle, Docker/just deployment |
| **Khang** (M4) | BR5, BR6 | Apache Iceberg on HDFS, Hive Metastore, gold models and indicators, compaction, time travel, Trino |

There are no extra roles. Everyone works on their own part independently. At the end, all four members **review each other's work with the checklists in section 8 and fix what is needed**.

---

## 3. Summary table

| Work item | Đạt | Nhân | Tịnh | Khang |
|---|---|---|---|---|
| **Report: chapters** | Ch.1 Intro, Ch.6 Conclusion, abstract, commitment; 3.1–3.2; 4.1 architecture; 5.5 comparison; 5.6 discussion; glossary | Ch.2 polish and Cassandra section; 3.5 data sources and characteristics; 4.3 processing technology | Ch.2 dbt/quality section; 3.6 mapping BR to processing; 5.1 setup; 5.2 correctness | Ch.2 Iceberg/HDFS/Trino section; 4.2 storage; 4.4 data model; 4.6 alternative |
| **Report: BR subsections (4.5, 5.4)** | BR01, BR07 | BR02, BR03 | BR04, BR08 | BR05, BR06 |
| **Report: application (4.7)** | User interface | Simulation and ingest | Deployment and config | – |
| **Benchmarks and evidence** | #6 API and web responsiveness, effectiveness measures | #1 trigger interval, #5 recovery and replay | Data-correctness checks (5.3) | #2 Cassandra vs Trino, #3 Iceberg vs Parquet, #4 compaction |
| **Video block (one continuous block each, in this order)** | **1st, 7.0 min:** context, users, the 8 BRs, data needs, architecture at a glance, demo BR1 and BR7 | **2nd, 7.0 min:** data sources and characteristics, streaming solution, streaming evaluation, demo BR2 and BR3 | **3rd, 7.0 min:** trust and alerts solution, correctness evaluation, demo BR4 and BR8 | **4th, 7.5 min:** lakehouse solution, alternative solution, performance evaluation, demo BR5 and BR6, effectiveness summary, conclusions |

---

## 4. Report plan (Vietnamese, `Reports/ProjectReport/`)

### 4.1 Required project content (the "application content" checklist, 4/10)

From the requirements PDF, the report must contain all of these. Missing items count against us:

1. Context of the project topic. 
2. Stakeholders (especially users), business requirements and data usage needs. 
3. Expected data sources and data characteristics. 
4. The data engineering solution and **at least one alternative solution** for comparison. 
5. The data management technology, the data processing technology, and how they are used. 
6. The developed application. 
7. Evaluation: **data correctness**, **performance**, **effectiveness of data exploitation through the application**. 
8. Conclusions.

The template covers all of them: items 1–3 map to chapters 1 and 3, items 4–6 to chapters 2 and 4, item 7 to chapter 5, item 8 to chapter 6.

### 4.2 Chapter assignments

Page budgets are targets, not limits. **Illustrative examples** means a code snippet, a configuration excerpt, a query with its result, or a diagram, all from our own system. The technology rubric asks for more than 3 per technology.

| Chapter and section | Owner | Pages | Content and sources | Illustrative examples to include |
|---|---|---|---|---|
| **Front matter**: commitment, abstract | Đạt | 1 | Fill last, after chapter 5. | – |
| **1. Giới thiệu**: bối cảnh, mục tiêu, phạm vi, bố cục | Đạt | 3 | Smart agriculture and IoT context; why near-real-time plus history; scope (8 BRs, 4 user groups). | – |
| 1. **Phân công công việc** | all | 1 | A table: member, BRs, technology area (section 2 of this file). | – |
| **2. Cơ sở lý thuyết**: existing micro-batch chapter | Nhân | 0–1 | Proofread and align with what we built (30 s trigger, checkpoint, watermark). | Already has code examples. |
| 2.x **Cassandra** | Nhân | 3 | Query-first modelling, TTL, our tables (`cassandra/schema.cql`). | At least 3: table definitions, one API query, TTL/alert-state example. |
| 2.x **dbt and data quality** | Tịnh | 3 | Medallion models, tests, quarantine, lineage columns. | At least 3: a model, a test, the quarantine table, a quality summary. |
| 2.x **Iceberg, HDFS, Hive Metastore, Trino** | Khang | 4 | Table format, snapshots, partitioning, compaction, why Trino. | At least 3: DDL, a time-travel query, a compaction call, a Trino query. |
| 2.x **FastAPI and the web app** | Đạt | 2 | Single access layer, route handlers, polling and caching rules. | At least 3: endpoint, response envelope, a screenshot. |
| **3. Phân tích yêu cầu và dữ liệu** | | | | |
| 3.1 Lĩnh vực ứng dụng; 3.2 Các bên liên quan | Đạt | 2 | `REQUIREMENTS.md` section 1. User groups U1–U4. | A user-group table. |
| 3.3 Yêu cầu nghiệp vụ | each own rows | 1 | Fill the "Phụ trách" column and the `\dien{...}` cells. Fix "Duy" to Khang. | The existing table. |
| 3.4 Nhu cầu sử dụng dữ liệu | each own BRs | 2 | BR → analysis type → needed latency. | A table. |
| 3.5 Nguồn dữ liệu, đặc trưng dữ liệu | Nhân | 3 | LoRaWAN-style sensors, the simulator, reference data; speed, volume, late, duplicate, missing and faulty data. | Payload example, fault-injection table. |
| 3.6 Ánh xạ yêu cầu sang xử lý dữ liệu | Tịnh | 2 | The traceability table from `REQUIREMENTS.md` section 4, explained. | The matrix. |
| **4. Thiết kế giải pháp và hiện thực ứng dụng** | | | | |
| 4.1 Kiến trúc tổng thể | Đạt | 2 | Architecture diagram, two dashboard types, data flow. | One diagram plus one flow description. |
| 4.2 Công nghệ quản lý dữ liệu | Khang | 2 | Why Cassandra, Iceberg on HDFS, Hive Metastore; the technology decisions table from `AGENTS.md`. | Decision table. |
| 4.3 Công nghệ xử lý dữ liệu | Nhân | 2 | Spark Structured Streaming 30 s, dbt on Spark, why not Flink or Airflow. | Trigger and checkpoint config. |
| 4.4 Thiết kế mô hình dữ liệu | Khang | 3 | Bronze, silver, gold; Cassandra tables; lineage columns. | Schema diagram, DDL. |
| 4.5 Pipeline theo từng BR | each own two BRs | 2 per BR (16 total) | For each BR: requirement, data flow, key code or SQL, result. | At least 1 snippet and 1 screenshot per BR. |
| 4.6 Giải pháp thay thế | Khang | 2 | Alternatives to compare (section 5.2). | Comparison table. |
| 4.7 Hiện thực ứng dụng: simulation and ingest | Nhân | 2 | Simulator, fault injection, ingest service. | Fault list, payload. |
| 4.7 Giao diện người dùng | Đạt | 3 | The 8 pages, design rules (scope, freshness, no colour-only status), screenshots. | One screenshot per page. |
| 4.7 Triển khai và cấu hình | Tịnh | 2 | Docker Compose profiles, `just` recipes, env config, memory sizing. | Compose excerpt, command list. |
| **5. Đánh giá** | | | | |
| 5.1 Thiết lập thực nghiệm | Tịnh | 2 | Hardware, Docker memory, data volume, versions, parameters. Every benchmark references this. | Environment table. |
| 5.2 Tính đúng đắn của dữ liệu | Tịnh | 4 | Fault injection results, reconciliation of gold against silver, duplicates, loss on restart. | Table of injected vs detected faults; reconciliation query. |
| 5.3 Hiệu năng | benchmark owners | 8 | Benchmarks #1–#6, see section 5. | One table and one chart each. |
| 5.4 Hiệu quả hỗ trợ khai thác dữ liệu | each own two BRs | 1 per BR | The acceptance criteria of each BR from `REQUIREMENTS.md`, with evidence. | An evidence table per BR. |
| 5.5 So sánh với giải pháp thay thế | Đạt (inputs from Khang and Nhân) | 2 | Results of the alternatives. | Comparison table. |
| 5.6 Thảo luận | Đạt (all inputs) | 2 | What worked, what did not, threats to validity. | – |
| **6. Kết luận** | Đạt | 2 | Results, limitations, future work. | – |
| **Tài liệu tham khảo, thuật ngữ** | all add references; Đạt owns the glossary | 2 | `refs.bib` currently has 4 entries; aim for 15 or more. | – |

Total about 80 pages. Each member writes roughly 19–24 pages.

### 4.3 Report writing rules

- One owner per section. Others comment, but do not edit another person's section without telling them.
- Branch per member (`docs/report-<name>`), small commits, and **do not commit build files** (`*.aux`, `*.log`, `*.pdf`, `*.fls`, `*.synctex.gz`). Only `.tex`, `.bib` and images.
- Every illustrative example comes from our own repo and is reproducible. Keep the command or the file path in the caption.
- Evaluation sections always state the configuration (see `AGENTS.md`, working rule 4).
- Replace every `\dien{...}` and `% TODO` before the final build. A search for them is part of the QA checklist.

---

## 5. Benchmarks and evidence (do before chapter 5)

The required benchmarks from `AGENTS.md` are not implemented. Without them chapter 5 has no numbers, and "evaluation of technology" (1/10) and the performance criterion are at risk. These are the first engineering tasks.

### 5.1 Benchmark tasks

| # | Benchmark | Owner | Existing stub | What to record | Output |
|---|---|---|---|---|---|
| 1 | Trigger interval 10 s / 30 s / 60 s: end-to-end latency, throughput, resource use | Nhân | `just bench-trigger` | Trigger, data volume, event rate, hardware, Docker memory | `benchmarks/results/trigger.csv` and a chart |
| 2 | Cassandra vs Trino-on-Iceberg for the same dashboard query | Khang | `just bench-lookups` | Query, rows, repeat count, p50/p95 latency, hardware | `benchmarks/results/lookups.csv` |
| 3 | Iceberg vs plain Hive/Parquet on the same data | Khang | `just bench-storage` | Schema, volume, file layout, query times, write behaviour | `benchmarks/results/storage.csv` |
| 4 | Effect of compaction on query time | Khang | `just bench-compaction` | File counts and sizes before and after, query time | `benchmarks/results/compaction.csv` |
| 5 | Recovery and replay: no loss, no duplicates | Nhân | `just bench-replay` | Offsets, batch counts, row counts before and after a job kill | `benchmarks/results/replay.csv` |
| 6 (extra) | API and web responsiveness, and effectiveness: response time of each endpoint, page load time, and the number of clicks from the Overview to a field summary | Đạt | none (new recipe `just bench-web`) | Endpoint, data volume, repeat count, p50/p95, clicks | `benchmarks/results/web.csv` |

Each script is a pure `just` recipe that calls a Python file in `benchmarks/`, and each result file stores its configuration in the first lines.

### 5.2 Alternative solutions

The requirements ask for **at least one** alternative. The plan proposes three, to gain the bonus:

1. **Storage alternative (Khang):** plain Hive/Parquet instead of Iceberg (benchmark 3).
2. **Processing alternative (Nhân):** a different micro-batch trigger interval, plus a discussion of Flink-style per-event processing (described, not built) (benchmark 1).
3. **Serving alternative (Khang):** Cassandra-only serving of the history queries (benchmark 2).

### 5.3 Correctness evidence (Tịnh, with all BR owners)

| Check | How | Evidence |
|---|---|---|
| Injected faults are all detected (duplicates, out of range, malformed, unknown device, null) | Run the simulator, compare injected counts with the quality summary | Table: injected vs detected, per fault |
| Gold reconciles with silver | Sample fields and days, recompute aggregates in SQL | Query plus equal results |
| No implausible values in gold | Fix the gold models to use only `quality_flag = 'ok'` rows and add accepted-range tests | Test run log |
| No loss and no duplicates after restart | Benchmark 5 (Nhân) | `replay.csv` |
| Acceptance criteria of each BR | Table in `REQUIREMENTS.md`, one row per criterion | Evidence column filled by the BR owner |

---

## 6. Slides and the flow of speaking (PDF `<GROUP_ID>_slides.pdf`, and the video)

The video is the whole presentation, so the slide deck **is** the video script. The order is fixed: **Đạt → Nhân → Tịnh → Khang**. Each member speaks in **one continuous block** and never returns later. The blocks are built so that this works:

- A block explains **a part of the solution** (technology and approach), shows the **evaluation of that part**, and **demonstrates the business requirements** that part serves.
- The first block sets the context and the requirements. The last block closes with the lakehouse and analytics, the effectiveness summary and the conclusions.
- Requirement 7 (evaluation) and requirement 6 (application) appear inside every block, not in one place, because splitting them across speakers would bring back the back-and-forth.
- The story follows the data: requirements → data and streaming (Nhân) → trust and alerts (Tịnh) → lakehouse and analytics (Khang).

### 6.1 Five sections (the rubric allows 4 to 7)

| Section | Title | Speaker | Slides | Minutes |
|---|---|---|---|---|
| 1 | Context, users, requirements and a first look at the application | Đạt | 1–8 | 7.0 |
| 2 | Data and the streaming solution (BR2, BR3) | Nhân | 9–14 | 7.0 |
| 3 | Trust, alerts and data correctness (BR4, BR8) | Tịnh | 15–18 | 7.0 |
| 4 | The lakehouse solution, alternatives, performance and effectiveness (BR5, BR6) | Khang | 19–24 | 6.75 |
| 5 | Conclusions | Khang | 25 | 0.75 |
| | **Total** | | **25 slides** | **28.5** |

Sections 1 to 4 are the four speaker blocks. Section 5 is a short closing section spoken by the same person as section 4, so Khang's block stays continuous.

### 6.2 Slide-by-slide flow (this is the order of speaking)

**Block 1: Đạt (7.0 min), section 1**

| # | Slide | Min | Content | Requirement covered |
|---|---|---|---|---|
| 1 | Title and agenda | 0.5 | Project title, the four speakers in order, the five parts | – |
| 2 | Context | 1.0 | Smart agriculture, IoT sensors, why data engineering is needed | R1 context |
| 3 | Stakeholders and user groups | 1.0 | U1 farm managers, U2 operators, U3 analysts, U4 data team, and what each needs | R2 stakeholders |
| 4 | The eight business requirements | 1.0 | BR1–BR8, one line each | R2 business requirements |
| 5 | Data usage needs | 1.0 | BR → type of analysis → needed latency (near real-time vs daily) | R2 data usage needs |
| 6 | Solution at a glance | 1.0 | Architecture diagram: Kafka, Spark, Cassandra, Iceberg, dbt, Trino, FastAPI, web; the two serving paths | R4 and R5 overview |
| 7 | Demo: BR1 and BR7 | 1.0 | Overview of farms and fields; a field page; Insights with the CSV export | R6 application |
| 8 | Result against the acceptance criteria | 0.5 | A new field appears without code change; clicks to a field summary; page load time (benchmark 6) | R7 effectiveness |

*Hand-over question to Nhân: "Where does all this data come from, and how messy is it?"*

**Block 2: Nhân (7.0 min), section 2**

| # | Slide | Min | Content | Requirement covered |
|---|---|---|---|---|
| 9 | Data sources | 1.0 | Sensors and gateways, reference data (farms, fields, devices, crop targets), the simulator | R3 data sources |
| 10 | Data characteristics | 1.0 | Rate, volume, late, duplicate, missing and faulty data; the fault-injection table | R3 data characteristics |
| 11 | The streaming solution | 1.5 | Kafka → Spark Structured Streaming (30 s trigger) → Cassandra, plus the raw stream to the lakehouse | R4 solution, R5 processing and management technology |
| 12 | Why these technologies | 1.0 | Micro-batch concept, checkpoint and idempotent writes, Cassandra query-first design; examples from our code | R5 approach |
| 13 | Evaluation: streaming | 1.5 | Trigger interval 10 / 30 / 60 s (latency and throughput); restart and replay with no loss and no duplicates; the micro-batch versus per-event alternative | R7 performance and correctness, R4 alternative |
| 14 | Demo: BR2 and BR3 | 1.0 | Live monitor refreshing; stop and restart the stream job; the gap record on Devices | R6 application |

*Hand-over question to Tịnh: "The data is flowing and stored. How do we know it is correct, and what happens when something goes wrong?"*

**Block 3: Tịnh (7.0 min), section 3**

| # | Slide | Min | Content | Requirement covered |
|---|---|---|---|---|
| 15 | Trust engineering | 1.5 | Explicit schema, quarantine, de-duplication, range validation, lineage columns, dbt tests | R5 approach (BR4) |
| 16 | Alerts engineering | 1.5 | Threshold and outage rules, debounce and cooldown, the open → acknowledged → resolved lifecycle | R5 approach (BR8) |
| 17 | Evaluation: data correctness | 2.0 | Injected faults vs detected faults; gold reconciled with silver; no implausible values in gold | R7 correctness |
| 18 | Demo: BR4 and BR8 | 2.0 | Quality page and a lineage drill-down; trigger a breach and an outage, then acknowledge and resolve | R6 application |

*Hand-over question to Khang: "With trusted data and alerts in place, how do we keep and analyse months of history, and why Iceberg rather than plain Parquet?"*

**Block 4: Khang (7.5 min), sections 4 and 5**

| # | Slide | Min | Content | Requirement covered |
|---|---|---|---|---|
| 19 | The lakehouse solution | 1.5 | Iceberg on HDFS, Hive Metastore, bronze, silver and gold; partitioning by date | R4 solution, R5 data management technology |
| 20 | Transformation and serving | 1.0 | dbt on Spark (medallion models, gold indicators: time in range, irrigation indicator), Trino as the query engine; examples | R5 processing technology and approach |
| 21 | Alternative solution | 1.0 | Plain Hive/Parquet, and Cassandra-only serving of history, compared by design | R4 alternative solutions |
| 22 | Evaluation: performance | 1.25 | Iceberg vs Parquet; effect of compaction; Cassandra vs Trino for the same dashboard query | R7 performance |
| 23 | Demo: BR5 and BR6 | 1.5 | Analytics: indicators and field comparison; period-over-period comparison; a time-travel query. The gold refresh after a target-range change is a short pre-recorded, sped-up clip | R6 application |
| 24 | Evaluation: effectiveness across the 8 BRs | 0.5 | The acceptance criteria of all 8 BRs with their evidence (one table, rows supplied by each owner) | R7 effectiveness |
| 25 | Conclusions | 0.75 | Results, limitations, future work, thanks | R8 conclusions |

### 6.3 Coverage of the course requirements (Project part)

Every required item of the requirements file maps to named slides. This table is also the check for the "application content" criterion.

| Requirement in the course file | Slides |
|---|---|
| Introduce the context of the project topic | 2 |
| Introduce stakeholders (especially users), business requirements and data usage needs | 3, 4, 5 |
| Present the expected data sources and data characteristics | 9, 10 |
| Present the data engineering solution | 6, 11, 15, 19 |
| Introduce at least one alternative solution (for comparison) | 13 (processing alternative), 21 (storage and serving alternatives) |
| Present the technology for data management, the technology for data processing, and the approaches to use them | 11, 12, 15, 16, 19, 20 |
| Develop the application (demonstrated) | 7, 14, 18, 23 (all 8 BRs) |
| Evaluate: data correctness | 13 (replay), 17 |
| Evaluate: performance of the data engineering solution | 13, 22 |
| Evaluate: effectiveness of supporting data exploitation through the application | 8, 24 |
| Conclusions about the project | 25 |

### 6.4 Slide rules

- One shared template, agreed by all four before anyone writes slides. After that, nobody changes fonts, colours or the master layout on their own.
- A slide is written by the member who presents it. The deck is built in the order of 6.2.
- Every slide with a claim shows evidence (a number, a screenshot, a diagram). Use real results from section 5, not estimates.
- Every technology slide carries an example from our own system, because "more than 3 examples" also applies to slides.
- **Speaker notes are mandatory.** Each slide has its spoken text in the notes, written by its presenter. The notes are the video script (section 7.2).
- A slide is written for a viewer who cannot ask questions: one message per slide, a title that states the message, and no text that is only read aloud.
- Format QA: a full spelling pass, consistent units, one date style, no clipped images. The rubric counts errors in text, colour, tables, images and spelling.

---

## 7. Video (20–30 minutes, `<GROUP_ID>_video.mp4`)

The video is the **only presentation of the Project part**. It replaces the face-to-face presentation of the slides and also contains the application demonstration. The rubric grades it on three things: content (the video follows 85–100% of the slides), presentation (confident, coherent, well coordinated, with appropriate interaction), and duration.

### 7.1 Running order and timing

The running order is exactly the slide order of section 6.2, with the speakers in the fixed order Đạt → Nhân → Tịnh → Khang.

| Time | Slides | Speaker | Content |
|---|---|---|---|
| 0:00–7:00 | 1–8 | **Đạt** | Context, users, the 8 BRs, data needs, architecture at a glance, demo of BR1 and BR7 |
| 7:00–14:00 | 9–14 | **Nhân** | Data sources and characteristics, streaming solution, streaming evaluation, demo of BR2 and BR3 |
| 14:00–21:00 | 15–18 | **Tịnh** | Trust and alerts, correctness evaluation, demo of BR4 and BR8 |
| 21:00–28:30 | 19–25 | **Khang** | Lakehouse solution, alternative solution, performance evaluation, demo of BR5 and BR6, effectiveness summary, conclusions |

Total 28.5 minutes. The margin of at least 1.5 minutes to the 30-minute limit absorbs a segment that runs long, and the video stays above the 20-minute minimum even if a segment is cut.

### 7.2 Script, hand-overs and interaction

Because there is no audience, coordination has to be written down.

1. **Master script.** The speaker notes of the deck are the script. Each member checks their own timing against the table in 7.1 (about 140 words per minute in Vietnamese, to be measured on the first rehearsal). The total is checked together in the rehearsals.
2. **Hand-over lines.** Each block ends with a sentence that names the next speaker and the topic. The next speaker opens by answering or acknowledging it. This is what makes the video one story instead of four talks.
3. **Scripted interaction (the rubric asks for appropriate interaction).** Three forward question-and-answer exchanges, each started by the speaker who is finishing and answered by the next speaker. Nobody comes back after their block:
   - Đạt to Nhân (end of slide 8): "Where does all this data come from, and how messy is it?"
   - Nhân to Tịnh (end of slide 14): "The data is flowing and stored. How do we know it is correct, and what happens when something goes wrong?"
   - Tịnh to Khang (end of slide 18): "With trusted data and alerts in place, how do we keep and analyse months of history, and why Iceberg rather than plain Parquet?"
4. **One consistent look.** Same slide template, same screen size and resolution, same audio level, and a small label with the speaker name and, during a demo, the BR code.
5. **Rehearsal.** Two timed full runs before recording. The first finds timing and wording problems. The second is a dress rehearsal with the real demo environment.

### 7.3 Recording and editing process

1. The team agrees on the recording tool (for example OBS), the resolution, a microphone check and a short clip template.
2. Each member records their own block as separate files named `<order>_<name>_<slides>.mp4`, from the **frozen** slides and notes. Anything that changes after the freeze is re-recorded.
3. The demo parts are recorded against the stable demo environment (7.5), from the runbook, with data already seeded.
4. The four recordings are joined in the order of 7.1 with the speaker labels, silences and mistakes are cut, subtitles are added, and the result is exported as mp4. The total length is checked against 20–30 minutes. The team does this together after the blocks are recorded.
5. All four members watch the final cut once, slide deck in hand, and tick the checklist in section 8. Every slide must be covered, and nothing important may appear in the video that is missing from the slides.

### 7.4 Demo script: one successful demonstration per BR (inside each speaker's block)

The rubric gives each BR an equal share of the largest criterion, so every BR needs a visible action and a visible result. The demo of each pair of BRs is the last part of that speaker's block (slides 7, 14, 18 and 23), so each member demonstrates their own two BRs without leaving their block. `docs/DEMO.md` holds the exact commands; each member writes the steps for their own two BRs.

| BR | Owner | Slide | Action on screen | Expected result to point out |
|---|---|---|---|---|
| BR1 | Đạt | 7 | Open Overview, filter farm then field, open a field page | One view of all farms and fields with status; an unknown device from the simulator is quarantined, not mis-assigned |
| BR7 | Đạt | 7 | Open Insights, change the period, export the CSV | Plain-language summaries, a ranked field comparison, a CSV that opens correctly |
| BR2 | Nhân | 14 | Open the Live monitor and watch two refreshes | Values change every 30 s, "data as of" updates, each panel is labelled |
| BR3 | Nhân | 14 | Stop the stream job for a few minutes, restart it, then show the Devices page gaps | No missing or duplicated readings after restart; the gap appears as an explicit gap record |
| BR4 | Tịnh | 18 | Open Data quality, open a device's lineage | Injected faults counted per type; any figure traces back to topic, partition, offset and batch |
| BR8 | Tịnh | 18 | Trigger a threshold breach and a device outage, then acknowledge and resolve an alert | Exactly one alert each; the lifecycle open, acknowledged, resolved is recorded; the outage alert closes when data resumes |
| BR5 | Khang | 23 | Open Analytics, compare fields, show the indicators; show the sped-up clip of a target-range change and gold refresh | Time-in-range and irrigation indicators change after the next refresh |
| BR6 | Khang | 23 | Open history, compare two periods, run a time-travel query on an earlier snapshot | Period-over-period comparison; the past report is reproduced identically |

### 7.5 Demo environment (agreed by all)

- One documented start order: `just up`, then the stream job, then the simulator, then the web app. Include the Windows note `MSYS_NO_PATHCONV=1`.
- Docker memory set to 8 GB (see section 1) and a written note of the hardware, for the evaluation chapter.
- A seeded dataset large enough for the history pages, built before recording, so the gold layer is not empty.
- A fallback: a short screen recording for each BR, so one failed live moment does not cost the segment.
- No other heavy applications open during recording.

---

## 8. Quality checklists (used by everyone in the mutual review)

Every member runs these lists on all four members' work before the files are submitted.

**Report**
- [ ] 6 chapters, each with a short introduction paragraph.
- [ ] No `\dien{...}` and no `% TODO` left.
- [ ] Every technology section has more than 3 examples from our own system.
- [ ] Every evaluation table states its configuration and refers to section 5.1.
- [ ] All 8 BRs appear in chapters 3, 4 and 5.
- [ ] The alternative solutions and their comparison are in chapters 4 and 5.
- [ ] Figures and tables have captions and are referenced in the text.
- [ ] At least 15 references, all cited.
- [ ] PDF named `<GROUP_ID>_report.pdf`; build files are not committed.

**Slides**
- [ ] 5 sections as in 6.1, each with a title slide or divider.
- [ ] Every required item in the table of section 6.3 is on a named slide.
- [ ] Every number matches the report.
- [ ] Spelling and format pass done by someone who did not write the slide.
- [ ] Timing of each part matches section 7.1.

**Video**
- [ ] Total length between 20 and 30 minutes (target 28.5).
- [ ] The speaking order is Đạt → Nhân → Tịnh → Khang, one continuous block each.
- [ ] Each member speaks for about 7 minutes.
- [ ] Every slide is covered; nothing major is in the video but missing from the slides.
- [ ] Every block ends with a hand-over to the next speaker.
- [ ] The three forward question-and-answer exchanges are on camera.
- [ ] Audio is even across members; no clipping.
- [ ] Every BR has a visible action and result.

**Demo and repo**
- [ ] A clean machine can follow `docs/DEMO.md` and reach all 8 BR results.
- [ ] No secrets or data files in the repo.
- [ ] Tests, lint, typecheck and build pass on `main`.
