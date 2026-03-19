Integer longCount = 0;
List<String> samples = new List<String>();
for (Account acc : [SELECT Id, Name, Original_Closed_Lost_Details__c FROM Account WHERE Original_Closed_Lost_Reason__c != null]) {
    if (acc.Original_Closed_Lost_Details__c != null && acc.Original_Closed_Lost_Details__c.length() > 255) {
        longCount++;
        if (samples.size() < 5) {
            samples.add(acc.Name + ' (' + acc.Original_Closed_Lost_Details__c.length() + ' chars): ' + acc.Original_Closed_Lost_Details__c.left(100) + '...');
        }
    }
}
System.debug('COUNT_OVER_255: ' + longCount);
for (String s : samples) {
    System.debug('SAMPLE: ' + s);
}
