List<Account> toUpdate = new List<Account>();
for (Account acc : [
    SELECT Id, Original_Closed_Lost_Details__c
    FROM Account
    WHERE Original_Closed_Lost_Reason__c != null
    AND Original_Closed_Lost_Details_Short__c = null
    LIMIT 200
]) {
    if (acc.Original_Closed_Lost_Details__c != null) {
        String details = acc.Original_Closed_Lost_Details__c;
        acc.Original_Closed_Lost_Details_Short__c =
            details.length() > 255 ? details.substring(0, 255) : details;
    } else {
        acc.Original_Closed_Lost_Details_Short__c = '(none)';
    }
    toUpdate.add(acc);
}
if (!toUpdate.isEmpty()) { update toUpdate; System.debug('Updated ' + toUpdate.size() + ' accounts'); }
