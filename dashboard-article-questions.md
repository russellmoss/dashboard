

**The "before" picture — what problem you were solving:**
- What were you using before this dashboard? Spreadsheets, native Salesforce reports, a BI tool? How painful was it? The contrast is what makes the "one week" timeline land emotionally for readers.


We were using Looker Studio before. It was a great free tool, but it lacked customization and the ability to rapidly and intuitively drilldown into underlying data. I was also constrained by the drag and drop GUI editor. It's vastly easier to converse with an LLM in natural language and build things that you want, rather than learn complex BI tools. 

- What was the trigger that made you decide to build instead of buy?

I started using Tableau and while it's more powerful than Looker Studio, with that power comes greater complexity and frustration.  I could spend a long time learning the nuances of Tableau, which could have taken a month. Or I could "vibe code" something that would be more powerful in a fraction of the time and would actually begin to form a knowledge base of business logic from which I can run other more poweful analyses more rapidly due to cursor.ai or claude code having the ultimate business logic context, which you can't get building with a GUI BI tool. 

**Your personal background / skill level:**
- Were you a full-stack engineer before, or more ops-focused who learned to code with AI? This dramatically changes the narrative. A RevOps manager shipping a production Next.js app in a week is a very different (and arguably more compelling) story than a senior engineer doing it.

I was not an engineer.  I was actually a farmer that became a winery General Manager with an owners mindset and a scarcity mindset.  I learned how to "vibe code" out of necessity. I had real world problems running a small struggling winery that I knew I could solve through software solutions, however there werent off the shelf solutions for what I wanted because wineries are such a nice industry.  I started with an online reputation management solution that took the winery from an obsure blip to being ranked number one on google and LLMs within 6 months of implementation.  That early success gave me the courage to keep pushing LLMs and my knowledge further to where I was developing scalable enterprise solutions with "vibes". 

- How much coding experience did you have before picking up Claude Code and Cursor?

I knew HTML, CSS and some javascript from just fun learning I did while I was teaching at Cornell just becuase I wanted to learn them.  I learned them through a coding course online.  I also know some R and python because of my academic background having gotten two masters in science and worked as a lecturer in viticulture at Cornell becuase those are good languages for statistical and spatial analysis. 

**The workflow specifics between Claude Code and Cursor:**
- Your doc mentions both tools but doesn't clearly delineate when you used which and why. Readers will want to know: Did you use Claude Code for the backend/SQL/data work and Cursor for frontend? Did you bounce between them? What's the division of labor?

I have an MCP connection to Big Query through cursor.ai  it's useful for exploring salesforce data in BigQuery and generating markdown documents related to that exploration.  This could be explorations of the data types and what each field is and how well filled out they are and how they may relate to other fields like stages relate to date fields of that stage and what the IDs are that join one record to another etc.  I start often with a data exploration like that to begin by building a full funnel view and then testing that view against a known SFDC report(s) in which I know what the numbers should be and if the view is reporting something different from what is known, I cna iterate with the LLM until we achieve what is correct.  I begin with that sort of exploration adn then put that in a Claude project as part of the knowledge base.  From there, I give Claude the context on what I am trying to build. I am extremely verbose so that it has as much context as possible.  I have found it's easiest to just stream of conciousness this part into Claude. I use Wispr Flow to talk this into Claude so that I can just pace around like a mad man and talk and tell Claude what I want to achieve with the initial build.  This includes functionalities and security concerns and ideas around how I want to deploy and what tech stack I want to use.  Then I feed it that along with the markdown regarding the existing data and have Claude ask me follow up questions before it generates a step by step phased markdown for agentic development.  I take that documetn and look it over and iterate upon it and then feed that markdown to cursror.ai for it to look at it and to query BQ with it's MCP to ensure that curosr.ai agrees with it relative ot what it knows about my data and rules etc.  After that is over, I have the final agentic development markdown in the directory and now I point claude code at the markdown and tell it to execute, stopping at the end of each phase ensuring that it runs all valdiation and verification steps and tells me what validation and vertification I must do in the UI/UX and using javascript in the developer console to ensure everything is operational. 

- Any specific prompts or prompting patterns that worked well (without giving away proprietary details)?

I just described how i do it. 

**Failures and dead ends:**
- What didn't work? Did you try an approach that the AI got wrong and you had to course-correct? This adds credibility and is more useful to readers than a pure success story.

Often the initial build is bare bones.  the UI/UX can be really messed up because it forgot a certain variable or something.  That's fine, you check it as part of the phased approach and there will be phases that are very UI/UX verification heavy.  You can just describe to the LLM what is occuring and 9 times out of 10, you can correct it with the agent in your first prompt. sometimes it takes 2-4 prompts to fully get it all sorted, but it's generally very good and MUCH better than what the systems were doing even a year ago. Another issue is around data correctness.  Again, you have a SFDC report that you and your team agreed is correct. So if you see reported that Q4 2025 had 315 SQOs in hte dashboard and in the SFDC report that is the true north, you know there is 320 SQOs, you can feed the LLM all the opportunity IDs of the 320 SQOs that are true and cursor.ai will query BQ with the MCP to determine the difference between the 320 SQOs and the 315 SQOs and why your dash isn't showing the 315.  It may be something like it's looking at Sept 1, 2025 to Nov. 30, but it's not going all the way to midnight of Nov 30, maybe it's cutting it off at noon and you had 5 past noon.  The new larger context with LLms like Claude and Gemini can handle this kind of analysis really well.  With LLMs for business use cases, context is king. 

**Quantifiable outcomes:**
- Time saved vs. previous reporting workflow

To create the dash that I built with an off the shelf solution would have likely taken me a month or two and taken me away from other extremely important tasks in a high grwoth startup.  By vibe coding it, it took me 1-2 weeks. 

- Cost (BigQuery spend with caching vs. without, or vs. a BI tool license)

I dont know, to be honest. 

- Adoption — are people actually using it? Any anecdotes about someone pulling a metric they couldn't access before?

People are using it and finding it MUCH more intuitive to get the information they need. 

**The maintenance / iteration story:**
- Your doc mentions "continuous rapid iteration" but some concrete examples would help. Like, "stakeholder asked for X on Tuesday, it was live by Wednesday" type anecdotes.

I was asked for a map of end users and I had it operational a day later.  I was also asked for an ad-hoc report that was very complex and because of the context of the project that the LLM has, I was able to generate a complex and thoorugh and accurate report within an hour. This same report would have taken days wihtout the approach and likely wouldnt have been as thorough and well presented. 

- How does the AI context advantage compound over time as the codebase grows?

As you work with your stakeholders more, debugging or creating new features for their use cases, the codebase grows and so does the context from which the LLM can borrow and build. It's like a child learning.  Your model is graduating from first grade, to second grade all the way to PHD by the time you've incorporated ML techniques and advanced math and reasoning. 

**Audience framing:**
- Who is this article for? Other RevOps/GTM leaders? Technical founders? Developers curious about vibe coding? Knowing this will shape tone significantly.

The article is for developers curious about vibe coding.  People that might not know where to begin, but they know they have great ideas that could be solved with a software solution, but they don't know where to begin and may be scared. I was a farmer. I know tractors and plants really well and I love them.  Now I build this stuff to solve real world issues and have largely forgone most SaaS solutions in favor of my custom builds for many problems. 

- Where will it be published — LinkedIn, a blog, Medium, dev.to?

Linkedin

Adding even a few paragraphs on the before/after, your skill level, and the Claude Code vs. Cursor workflow split would make the biggest difference. Those are the pieces that turn a technical walkthrough into a narrative people actually share.