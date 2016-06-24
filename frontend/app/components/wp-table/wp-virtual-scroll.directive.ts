// -- copyright
// OpenProject is a project management system.
// Copyright (C) 2012-2015 the OpenProject Foundation (OPF)
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See doc/COPYRIGHT.rdoc for more details.
// ++

import {wpDirectivesModule} from "../../angular-modules";
import {scopedObservable} from "../../helpers/angular-rx-utils";
import IScope = angular.IScope;
import IRootElementService = angular.IRootElementService;
import IAnimateProvider = angular.IAnimateProvider;
import ITranscludeFunction = angular.ITranscludeFunction;


function getBlockNodes(nodes) {
  var node = nodes[0];
  var endNode = nodes[nodes.length - 1];
  var blockNodes = [node];

  do {
    node = node.nextSibling;
    if (!node) {
      break;
    }
    blockNodes.push(node);
  } while (node !== endNode);

  return $(blockNodes);
}

function createDummyRow(content: any) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.innerHTML = content;
  tr.appendChild(td);
  return tr;
}

function disableWatchers(element: any) {
  var data = element.data();
  console.log(data);

}

function wpVirtualScrollRow($animate: any,
                            workPackageTableVirtualScrollService: WorkPackageTableVirtualScrollService) {
  return {
    multiElement: true,
    transclude: 'element',
    priority: 600,
    terminal: true,
    restrict: 'A',
    $$tlb: true,

    link: ($scope: IScope,
           $element: IRootElementService,
           $attr: any,
           ctrl: any,
           $transclude: ITranscludeFunction) => {

      new RowDisplay($animate, $scope, $element, $attr, $transclude, workPackageTableVirtualScrollService);
    }
  };
}

wpDirectivesModule.directive('wpVirtualScrollRow', wpVirtualScrollRow);

class RowDisplay {

  private block: any;
  private childScope: IScope;
  private previousElements: any;

  private dummyRow: HTMLElement;
  private index: number;
  private viewport: [number, number] = [0, 5];
  private visible: boolean = undefined;
  private clone: JQuery;

  constructor(private $animate: any,
              private $scope: angular.IScope,
              private $element: angular.IRootElementService,
              private $attr: any,
              private $transclude: angular.ITranscludeFunction,
              private workPackageTableVirtualScrollService: WorkPackageTableVirtualScrollService) {

    this.index = $scope.$eval($attr.wpVirtualScrollRow);

    scopedObservable($scope, workPackageTableVirtualScrollService.viewportChanges)
      .subscribe(vp => {
        this.viewport = vp;
        this.viewportChanged();
      });

  }

  private isRowInViewport() {
    return this.index >= this.viewport[0] && this.index <= this.viewport[1];
  }

  private isRowInViewportOffset() {
    const offset = this.workPackageTableVirtualScrollService.viewportOffset;
    return this.index >= (this.viewport[0] - offset) && this.index <= (this.viewport[1] + offset);
  }

  private viewportChanged() {
    const isRowInViewport = this.isRowInViewportOffset();
    const enableWatchers = this.isRowInViewport();

    if (this.visible === undefined) {
      // First run
      this.renderRow(isRowInViewport);
    } else if (!this.visible && isRowInViewport) {
      this.hide();
      this.renderRow(true);
    } else if (!this.visible && !isRowInViewport) {
      this.renderRow(false);
    }

    if (this.clone) {
      this.adjustWatchers(this.clone, enableWatchers);
    }
  }

  renderRow(renderRow: boolean) {
    this.hide();
    if (!this.childScope) {
      if (renderRow) {
        // render work package row
        this.$transclude((clone: any, newScope: any) => {
          this.clone = clone;
          this.childScope = newScope;
          this.visible = true;

          clone[clone.length++] = document.createComment(' wp-virtual-scroll: ' + this.index + ' ');
          this.block = {
            clone: clone
          };
          this.$animate.enter(clone, this.$element.parent(), this.$element);
        });
      } else {
        // render placeholder row
        this.visible = false;
        this.dummyRow = createDummyRow("Loading...");
        this.$animate.enter(this.dummyRow, this.$element.parent(), this.$element);
      }
    }
  }

  private hide() {
    this.dummyRow && this.$element.parent()[0].removeChild(this.dummyRow);
    this.dummyRow = null;

    if (this.previousElements) {
      this.previousElements.remove();
      this.previousElements = null;
    }
    if (this.childScope) {
      this.childScope.$destroy();
      this.childScope = null;
    }
    if (this.block) {
      this.previousElements = getBlockNodes(this.block.clone);
      this.$animate.leave(this.previousElements).then(() => {
        this.previousElements = null;
      });
      this.block = null;
    }
  }

  private adjustWatchers(element: JQuery, enableWatchers: boolean) {
    const data = angular.element(element).data();
    if (!data.hasOwnProperty("$scope")) {
      return;
    }

    const scope = data.$scope;
    if (!enableWatchers) {
      if (scope.$$watchers && scope.$$watchers.length > 0) {
        scope.__backup_watchers = scope.$$watchers;
        scope.$$watchers = [];
      }
    } else {
      if (scope.__backup_watchers && scope.__backup_watchers.length > 0) {
        scope.$$watchers = scope.__backup_watchers;
        scope.__backup_watchers = [];
      }
    }


      angular.forEach(angular.element(element).children(), (child: JQuery) => {
        this.adjustWatchers(child, enableWatchers);
      });

  }

}


class WorkPackageTableVirtualScrollService {

  private rowHeight: number = 44;

  private element: JQuery;

  private lastRowsAboveCount: number;

  private lastRowsInViewport: number;

  public viewportOffset = 0;

  public viewportChanges: Rx.Subject<[number, number]> = new Rx.ReplaySubject<[number, number]>(1);

  setTableElement(element: IRootElementService) {
    this.element = element;
  }

  updateScrollInfo() {
    const scrollTop = this.element.scrollTop();
    const height = this.element.outerHeight();
    const rowsAboveCount = Math.floor(scrollTop / this.rowHeight);
    const rowsInViewport = Math.round(height / this.rowHeight) + 1;

    if (rowsAboveCount !== this.lastRowsAboveCount || rowsInViewport !== this.lastRowsInViewport) {
      this.viewportChanges.onNext([rowsAboveCount, rowsAboveCount + rowsInViewport]);
    }

    this.lastRowsAboveCount = rowsAboveCount;
    this.lastRowsInViewport = rowsInViewport;
  }

}

wpDirectivesModule.service("workPackageTableVirtualScrollService", WorkPackageTableVirtualScrollService);


function wpVirtualScrollTable(workPackageTableVirtualScrollService: WorkPackageTableVirtualScrollService) {
  return {
    restrict: 'A',
    link: ($scope: IScope, $element: IRootElementService) => {

      workPackageTableVirtualScrollService.setTableElement($element);

      let scrollTimeout: any;
      $element.on("scroll", () => {
        scrollTimeout && clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          //$scope.$applyAsync(() => {
          workPackageTableVirtualScrollService.updateScrollInfo();
          //});
        }, 500);
      });

      workPackageTableVirtualScrollService.updateScrollInfo();

    }
  };
}

wpDirectivesModule.directive('wpVirtualScrollTable', wpVirtualScrollTable);
