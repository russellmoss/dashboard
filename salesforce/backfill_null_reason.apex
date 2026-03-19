// Handle the 12 accounts where the earliest Recruiting Closed Lost opp has a null Closed_Lost_Reason__c
// Sets Original_Closed_Lost_Reason__c to '(none)' and copies Details if available

List<Account> accountsToUpdate = new List<Account>();

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
        // Source reason is null — store '(none)' so this account is no longer picked up as "needs backfill"
        acc.Original_Closed_Lost_Reason__c = earliest.Closed_Lost_Reason__c != null ? earliest.Closed_Lost_Reason__c : '(none)';
        acc.Original_Closed_Lost_Details__c = earliest.Closed_Lost_Details__c;
        accountsToUpdate.add(acc);
    }
}

if (!accountsToUpdate.isEmpty()) {
    update accountsToUpdate;
    System.debug('Updated ' + accountsToUpdate.size() + ' accounts');
}
