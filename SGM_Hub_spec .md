**SGM Hub spec** 

Architecture

* It will be multiple tabs like in the SGA Hub  
  * LEADERBOARD: The first tab would be a leaderboard of Joined advisors, similar to the SGA leaderboard of SQOs.  It would have 4 columns: Rank, Name, \# Joined and Joined AUM. They are ranked on Joined QUM.  It would have the same filters as the SGA leaderboard adn default to current quarter. Unlike the SGA leaderboard,  it would have all channels selected by default and instead of having “SGA” selections, you’d be able to select the SGMs.  The rankings would be based upon Joined AUM. You should be able to click on either the \# joined or the Joined AUM values and see a drilldown modal to show you all the advisors that joined for that person and their details and from there you can click into the record as you do in all of our drilldowns.,   It should follow the same styling as the leaderboard of the SGA hub 

  * SGM DASHBOARD: This is a main dashboard showing the SGMs their key statistics.  They should be able to filter using the same global filters that exist on the “Funnel Performance” page and they should have the same kind of “advanced filters” option as they have there. They don't need the “experimentation tag” filters”.  It should show the same scorecards that we see on “Funnel Performance” “Focused View”.  It shouldn’t show the full funnel view. If they are an user type \= SGM, they should default the filtration to the SGM user only in the filter, they can, of course, filter to whoever they want or the entire team, but we want them to see their specific data only initially.  We want to add scorecards for Joined ARR (actual) which comes from ``Account_Total_ARR__c FROM `savvy-gtm-analytics.SavvyGTMData.Account`` And we want another scorecard for “Estimated ARR” `` SGM_Estimated_ARR__c FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` `` and another for “Est. ARR:Actual ARR Ratio” that is a ratio of the two values.   
    

    Admin and Rev\_Ops admin user types should be not have any particular user filters and should see everyone by default. The scorecards should all be drilldownable as they are on the Funnel Performance page. 

    Below the cards, we should see the SQL to SQO conversion rate and the SQO to Joined Conversion rate. Below that, we should see conversion rate and conversion volume trend charts that are cohorted and quarterly and shows the SQL to SQO and SQO to Joined conversion rates in one and the SQL, SQO and Joined volumes in another and you can click on the volumes bars and get drill downs as you can in the volume chart in the Funnel Performance page.  The difference with these charts, relative to the funnel performance charts, is that they are only cohorted (no periodic view) and I want the user to be able to select how many quarters they want to display?  It defaults to the current quarter they have selected within their date range filter and then the 3 quarters prior, but if they want to see 5, 6, 7, 8 quarters back, they can select that and see that within those graphs.  They dont need to see the charts monthly either, like on the funnel Performance page, just quarterly and cohorted.   
      
    Below that, we want to see the chart from the Open pipeline page [https://dashboard-eta-lime-45.vercel.app/dashboard/pipeline](https://dashboard-eta-lime-45.vercel.app/dashboard/pipeline) that is the Pipeline by Stage chart, and features it’s own set of filters for Opportunity Stages  It doesn’t need the SGM filter like on the open pipeline page because we will already have the SGM filters as global filters for the page.  It should be drilldownable and have the same default filters for stages as the Open Pipeline chart. 

    Below that, we want to see the SGM Conversion & Velocity table that is on the open pipeline By SGM tab.  It should also show their “SQO \-\> Joined (days)” which is the average amount of time from the time they SQO someone to when they Stage\_entered\_joined\_\_c (``Stage_Entered_Joined__c FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`)``   
    

    Below that, we should show the “Stale Pipeline” charts from the Open Pipeline by stage tab.   
    

  QUOTA TRACKING: User type \= SGM will only be able to see their own specific data on this tab, like how the User type \= SGA can only see their specific data on the Quarterly Progress tab of the SGA Hub.  The Admin and Rev\_Ops admin user types will have a global view of all the SGMs data on this tab.  For the SGM view on this tab, they should have the quarter drop down like the SGA quarterly progress and below that, they should see the same things as they see on the SGA quarterly progress where they see Quarterly Progress and it shows the quarter it’s looking at and then below that should be their actual `` Actual_ARR__c FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` ``  (As they are judged against their “actual ARR” for any given quarter, as opposed to SQOs like the SGAs) against their quota ARR. and they should see a gauge that shows their Actual ARR for that quota with the “full” being their quota value.  They should also see pacing like we have in SGA Hub Progress, but instead, it’s against their ARR quota for the quarter and we pace it similarly where we take the full quarterly quota and parse it out across each day of the quarter.   So if they have a $1,000,000 ARR quota and it’s a 90 day quarter and we are 45 days into the quarter, we expect them to have $500,000 in ARR, but they actually only have $250,000 in ARR, so they are 100% below their pacing and they are on track for $500,000 for the quarter at that particular pacing. 

    Below that, they should see, like in the SGA Hub Quarterly progress a chart similar to the one in the SGA Hub called “Historical Quarterly Progress \- SQO counts by quarter with goal overlay (if set)”, but this will be one called “Historical Quarterly Progress \- Actual ARR by quarter with goal overlay (if set) and will show the current quarter that they are filtered to and the subsequent 7 quarters.  THey should be able to click on the bars in those charts to see all the joined opportunities that make up that ARR too and click on those for the details of each as well.  

    Below that, they should see a list of their “Open Opportunities” that they can click into and see all the details.  They should see the following in the columns: Advisor Name, Days Open (color coded similar to the color coding that happens in the Stale Pipeline Alerts table so they are red at 90+ days, Orange if 60 \- 86 days, yellow if 30-59 days and green if 0 to 29 days), Current Stage (this is the stage of “qualifying”, “discovery”, “sales process”, “negotiating”, “on hold”, “signed”. And then they should have a column for “Days in stage” which also follows the same color scheme in terms of time buckets. Another column for “AUM” which would follow the same logic as our “Opportunity AUM” which is where we use the core calculation:  
    COALESCE(o.Underwritten\_AUM\_\_c, o.Amount) AS Opportunity\_AUM  
    1\. If Underwritten\_AUM\_\_c has a value → use it  
    2\. If Underwritten\_AUM\_\_c is NULL → fall back to Amount  
    3\. If both are NULL → result is NULL  
    
    Both fields come from the Opportunity object in Salesforce (lines 186-187). Underwritten\_AUM\_\_c is a custom field (the underwriting team's verified AUM figure), while Amount is the standard Salesforce opportunity amount field.  
  

       Then we would have a column for Est. ARR that comes from  `` SGM_Estimated_ARR__c FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` ``

      
      
    Then for the view in the “Quarterly Progress” view that is for the User Type \= Admin and User type \= Rev-ops, we should see a similar view that is in the Quarterly Progress tab for the SGA HUB with the same global filters, except in place of the “SGAs” filter, they should have SGM and all SGMs, All channels, All sources should be selected and all pacing status then at the top they should see the team progress which is the total Joined ARR for the quarter against the goal of Joined ARR and shows a progress bar for that and it should default to the current quarter. 

    Below that, I want to see a table called: 

    Individual SGM Breakdown 

    It will have columns of: 

    SGM Name, Open Opps (this is a number of all their open opportunities that they can click into and see the drillodwn modal) and and then another column called “Open Opps 90+ days”, which are opportunities that have been open for over 90 days and they can click into that number and then it shows columns for Open AUM (comes from sum of Opportunity AUM) and Open ARR (sum of s`GM_Estimated_ARR__c) and then “progress %” which is their progress towards their quarterly Joined ARR.`  

    `Then below that is an editable table for “SGM Quota”` 

    `This is a table where they can set the quarterly quotas for the SGMs like this:` 

|  | Q1 \- 2026 | Q2 \- 2026 | Q3 \- 2026 | Q4 \- 2026 |
| :---- | ----- | ----- | ----- | ----- |
| Bre McDaniel | $2,000,000 | $2,000,000 | $2,000,000 | $2,000,000 |
| Corey Marcello | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Bryan Belville | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Erin Pearson | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Jade Bingham | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Tim Mackey | $650,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Arianna Butler | $650,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Lexi Harrison | $325,000 | $0 | $758,333 | $1,300,000 |
| David Eubanks | $0 | $650,000 | $1,300,000 | $1,300,000 |
| Clayton Kennamer | $0 | $650,000 | $1,300,000 | $1,300,000 |
| Lena Allouche | $0 | $325,000 | $1,191,667 | $1,300,000 |

    

* `FORECAST: We will add a forecasting tab later, but for this current build we wont do it.  THat will incorporate Deal Stage probability weighting for each person (and the whole team)`