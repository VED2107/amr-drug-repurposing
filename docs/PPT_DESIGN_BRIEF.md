# Presentation brief — Smart Screening (for Claude Design)

**Audience:** medical and pharmacy students. Explain the idea plainly. Skip
code, model names and database terms.
**Length:** 10 slides, mostly visual, with few words on each.
**Tone:** calm and editorial, like a research instrument. It should not read
as a sales pitch.

---

## Visual style

- Background: warm paper `#F6F4EF`. Cards: `#FFFDF8`. Text: ink `#12130F`
  (never pure black). Lines: `#DCD7CC`.
- One accent colour, ochre `#B45309`. Links: indigo `#3730A3`.
- Evidence colours, used the same way on every slide:
  - Clinical record: green `#047857` ◆
  - Lab measurement: teal `#0F766E` ■
  - Computer prediction: indigo `#4338CA` ▲
  - Nothing found: ochre `#B45309` ○
  - Not yet checked: grey `#6E6A5F` —
- Fonts: Bricolage Grotesque for headings, Literata for body text, Geist Mono
  for every number.
- 2px corners, flat surfaces, no gradients or glow, and almost no animation.

---

## Slides

### 1. Title
**Smart Screening: AI that searches approved medicines for new antibacterial uses**
Subtitle: Four drug-resistant bacteria. 1,761 approved medicines. One
screening pipeline.
Visual: a pill or capsule outline with a faint molecule drawn inside it.

### 2. What is drug repurposing?
This means finding a new use for a medicine that is already approved.
- Aspirin: from pain relief to heart-attack prevention
- Sildenafil: from angina to erectile dysfunction
- Thalidomide: from a sedative to multiple myeloma

Why it helps: human safety data already exists, the medicine is already
manufactured, and development can be years shorter.
Visual: three "from → to" arrow cards.

### 3. The problem: antimicrobial resistance (AMR)
- **1.27 million** deaths a year are directly caused by drug-resistant
  bacteria (2019 global estimate).
- A new antibiotic takes **10–15 years** and **over $1 billion** to develop.
- Routine infections such as UTIs, wound infections and pneumonia become hard
  to treat.

Visual: one large number with three small stat tiles beneath it.

### 4. The four bacteria we studied
| Bacterium | Type | How it resists |
| --- | --- | --- |
| **MRSA** (*S. aureus*) | Gram-positive | Altered PBP2a protein, so penicillin-type drugs cannot bind |
| **E. coli** | Gram-negative | Outer membrane, and pumps that push drugs out |
| **K. pneumoniae** | Gram-negative | Carbapenemase enzymes that destroy last-resort antibiotics |
| **M. tuberculosis** | Acid-fast | Thick waxy mycolic-acid wall |

All four are WHO priority pathogens.
Visual: four simple cell-wall cross-section icons in a row.

### 5. How it works: five steps
1. **Collect**: approved medicines from the FDA, and lab test results from
   ChEMBL
2. **Decode**: turn each molecule's structure into a digital fingerprint
3. **Predict**: an AI model, trained on about 35,000 past lab results,
   estimates whether each medicine is likely to be active against each bacterium
4. **Check fit**: computer docking tests whether the molecule fits a key
   bacterial protein
5. **Look up history**: what each medicine has already been studied for on
   ClinicalTrials.gov

Visual: a horizontal 5-step flow with one icon for each step.

### 6. What a result means, and what it does not
This is the most important slide for a medical audience.
- **"81% predicted"** is the model's estimated chance that the medicine shows
  activity *in a lab test*. It is **not** a cure rate or an effectiveness
  figure.
- **Docking score** (for example −9.7 kcal/mol) estimates how well the
  molecule fits the protein. Our screening target is −7.0. A good fit does not
  prove that the medicine works in a patient.
- **A registered trial** shows that someone studied the medicine. It does not
  show that the study succeeded.
- **"Nothing found", "not yet checked" and "no effect"** are three different
  statements, and we keep them separate.

Visual: the evidence ladder, using the five evidence colours in order from
strongest to weakest.

### 7. Results at a glance
- **1,761** approved medicines screened against all 4 bacteria
- **1,019** medicines are repurposing candidates: they have at least 40%
  predicted lab activity against at least one bacterium and are not already
  antibacterials (count as of 29 Sept 2026)
- **1,761 of 1,761** medicines were checked on ClinicalTrials.gov, and 1,546
  have registered studies
- **53** medicines were docked so far (only a subset)

Visual: four stat tiles. Numbers go in mono.

### 8. Case study: Levoketoconazole and tuberculosis
- Approved use: **Cushing's syndrome** (brand Recorlev)
- AI prediction: **81%** estimated chance of lab activity against
  *M. tuberculosis*
- Docking: **−9.7 kcal/mol** against InhA, a TB cell-wall enzyme. This is
  better than the −7.0 target.
- Trial history: **6** registered studies, all for Cushing's syndrome or
  healthy volunteers, and **0** for infection

**Honest caveat:** its close chemical relative, ketoconazole, was in the
training data. The model may be recognising a known pattern rather than
discovering something new. This is a lead for lab testing, not a treatment.
Visual: a 4-step vertical journey (database → AI → docking → trials), with the
caveat in an ochre callout box.

### 9. Limits and what comes next
**Current limits:**
- The models predict activity against the *species*, not specifically against
  resistant strains. Very few resistant-strain lab records exist.
- Docking covers only a subset of medicines.
- Nothing here has been tested in a lab or in patients.

**Next steps:** lab testing of top candidates, 3D deep-learning models,
combination therapies with old antibiotics, and other diseases.
Visual: two columns, "Today" and "Next".

### 10. Closing
**Faster leads, honestly labelled.** AI narrows thousands of safe medicines
down to a short list worth testing in the lab.
Thank you.

---

## Words to avoid on any slide
- "cure", "effective", "efficacy" or "success rate" next to a percentage
- "proves", "guarantees", "physically locks"
- "approved for TB/infection" (approval was for the original use only)
- "real patient outcomes" (trial registrations are not outcomes)
