// Backfill Original Closed Lost fields for all accounts with Closed Lost Recruiting opps
// Processes in batches of 200 to stay within governor limits

List<Account> accountsToUpdate = new List<Account>();

// Get all accounts with Closed Lost Recruiting opps that don't have Original fields populated
for (Account acc : [
    SELECT Id,
           (SELECT Id, Closed_Lost_Reason__c, Closed_Lost_Details__c, CreatedDate
            FROM Opportunities
            WHERE RecordType.DeveloperName = 'Recruiting'
              AND StageName = 'Closed Lost'
            ORDER BY CreatedDate ASC
            LIMIT 1)
    FROM Account
    WHERE Id IN (
        SELECT AccountId FROM Opportunity
        WHERE RecordType.DeveloperName = 'Recruiting'
          AND StageName = 'Closed Lost'
          AND AccountId != null
    )
    AND Original_Closed_Lost_Reason__c = null
    LIMIT 200
]) {
    if (!acc.Opportunities.isEmpty()) {
        Opportunity earliest = acc.Opportunities[0];
        acc.Original_Closed_Lost_Reason__c = earliest.Closed_Lost_Reason__c;
        acc.Original_Closed_Lost_Details__c = earliest.Closed_Lost_Details__c;
        accountsToUpdate.add(acc);
    }
}

if (!accountsToUpdate.isEmpty()) {
    update accountsToUpdate;
    System.debug('Updated ' + accountsToUpdate.size() + ' accounts');
}
