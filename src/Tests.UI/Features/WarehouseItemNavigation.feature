Feature: WarehouseItemNavigation

Scenario: User can open a warehouse item from the main view
    Given I am logged in as 'user119@lab.talxis.com'
    And I open the 'lab_warehouseapp' app
    When I click on 'Warehouse Items' in the sitemap
    Then I should see the 'Active Warehouse Items' view
