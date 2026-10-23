# Recovery Forward Foundation

**Recovery. Opportunity. A Future Forward.**

Recovery Forward Foundation is a nonprofit organization dedicated to helping people build stable, productive lives during and after recovery from addiction.

Our goal is to help bridge the gap between completing recovery treatment and successfully rebuilding a life.

## Our Mission

To support individuals committed to long-term recovery by providing resources, opportunities, financial assistance, and community support that encourage stability, independence, and continued recovery.

## What We Are Building

Recovery Forward Foundation is developing programs focused on:

- Recovery milestone grants
- Assistance with rebuilding after treatment
- Employment and educational opportunities
- Community resources and partnerships
- Transparent and accountable charitable funding
- Privacy-conscious assistance applications
- Long-term recovery support

## Recovery Grant Program

The Foundation is developing a grant system designed to recognize meaningful recovery milestones.

Applicants will be able to receive a randomly generated **RCGI ID** that allows an application to be referenced without publicly exposing unnecessary personally identifiable information.

The technical registry supporting this program is maintained separately in the `recovery-grant-registry` project.

## Transparency

Recovery Forward Foundation is committed to responsible governance, clear eligibility standards, auditable grant decisions, and transparent use of charitable funds.

Technology may be used to improve transparency and accountability while protecting the privacy and dignity of program participants.

## Website

Official domain:

**recoveryforwardfoundation.org**

The public website is maintained in the `/docs` directory of this repository.

## Repository Structure

- `docs/` — Foundation website
- `governance/` — Governance documents, bylaws, policies, and board resources
- `programs/` — Program documentation
- `governance/bylaws/` — Organizational bylaws
- `governance/policies/` — Foundation policies
- `governance/board/` — Board documentation

## Status

Recovery Forward Foundation is currently in its organizational and development stage.

Programs, eligibility requirements, governance procedures, and funding mechanisms will continue to be documented as the Foundation develops.

---

© 2026 Recovery Forward Foundation

## Seasonal Themes

Every public page loads `docs/css/seasonal.css` and `docs/js/seasonal-theme.js`. The engine picks one of twelve themes from the current month in `America/Indiana/Indianapolis`, so it switches on the 1st of each month with no redeploy (open tabs re-check every minute). Visitors can turn effects off with the toggle at the bottom of each page, and `prefers-reduced-motion` disables animation automatically. Preview any theme with `?season=october` (or `1`–`12`). Run the tests with `npm install && npm test`.
